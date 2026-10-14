import { z } from 'zod';
import type { Action } from '@bolinha/core';
import type { MarketSnapshot } from '@bolinha/market-data';

const wireSchema = z.object({ acao: z.string(), valor_usdt: z.coerce.number().finite().nonnegative(), confianca: z.coerce.number().min(0).max(1), motivo: z.string().min(1).max(2000) });
export interface AiDecision { action: Action; amountUsdt: number; confidence: number; reason: string; rawResponse: string | null }
export interface AiUsage { modelRequested: string; modelReturned: string | null; promptTokens: number | null; completionTokens: number | null; totalTokens: number | null; costUsd: number | null; latencyMs: number; error: string | null; fallbackUsed: boolean }
const actionMap: Record<string, Action> = { BUY:'BUY', SELL:'SELL', HOLD:'HOLD', COMPRAR:'BUY', COMPRA:'BUY', VENDER:'SELL', VENDA:'SELL', WAIT:'HOLD', ESPERAR:'HOLD', AGUARDAR:'HOLD' };
export function parseAiContent(content: string | null | undefined): AiDecision { if(!content)return {action:'HOLD',amountUsdt:0,confidence:0,reason:'AI returned empty content',rawResponse:content??null}; try { const jsonMatch=content.match(/\{[\s\S]*\}/); const parsed=wireSchema.safeParse(JSON.parse(jsonMatch?.[0] ?? content)); if(!parsed.success)return {action:'HOLD',amountUsdt:0,confidence:0,reason:'Invalid AI response schema',rawResponse:content}; const action=actionMap[parsed.data.acao.trim().toUpperCase()]; if(!action)return {action:'HOLD',amountUsdt:0,confidence:0,reason:'Invalid AI action',rawResponse:content}; return {action,amountUsdt:parsed.data.valor_usdt,confidence:parsed.data.confianca,reason:parsed.data.motivo,rawResponse:content}; } catch { return {action:'HOLD',amountUsdt:0,confidence:0,reason:'Invalid AI JSON',rawResponse:content}; } }
export function buildB3Prompt(

  snapshot: MarketSnapshot,
  account: { initialBankBrl: number; cashBrl: number; realizedPnlBrl?: number },
  position: { ticker: string; quantity: number; entryPrice: number; costBrl: number } | null,
  currentPrice: number,
): string {
  const maxSharesCanBuy = currentPrice > 0 ? Math.floor(Math.max(0, account.cashBrl) / currentPrice) : 0;
  const maxBuyAmountBrl = (maxSharesCanBuy * currentPrice).toFixed(2);
  const permitted = position
    ? (maxSharesCanBuy > 0 ? 'BUY (aumentar posição), SELL (parcial ou total) ou HOLD' : 'SELL (parcial ou total) ou HOLD (caixa insuficiente para BUY)')
    : (maxSharesCanBuy > 0 ? 'BUY ou HOLD' : 'HOLD (caixa insuficiente para compra de 1 ação)');
  const availableCashBrl = Number(account.cashBrl).toFixed(2);
  const initialBankFormatted = Number(account.initialBankBrl).toFixed(2);

  let positionInfo = 'nenhuma';
  let pnlInfo = '';
  if (position) {
    const unrealizedPnlBrl = (currentPrice - position.entryPrice) * position.quantity;
    const unrealizedPnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    positionInfo = `${position.quantity} ações de ${position.ticker}, preço de entrada R$ ${position.entryPrice.toFixed(2)}, custo total R$ ${position.costBrl.toFixed(2)}`;
    pnlInfo = `PnL não realizado atual: ${unrealizedPnlPct >= 0 ? '+' : ''}${unrealizedPnlPct.toFixed(2)}% (R$ ${unrealizedPnlBrl.toFixed(2)}).`;
  }

  return `Você é um analista e operador especialista em Day Trade de Ações na B3 (Bolsa Brasileira).
Responda SOMENTE JSON: {"acao":"BUY|SELL|HOLD","valor_usdt":number,"confianca":0..1,"motivo":"..."} (onde "valor_usdt" representa o valor financeiro alocado em R$ BRL).
Contexto financeiro B3: banca inicial R$ ${initialBankFormatted}; caixa disponível R$ ${availableCashBrl}; capacidade máxima de compra atual: ${maxSharesCanBuy} ação(ões) (máx R$ ${maxBuyAmountBrl}); posição atual: ${positionInfo}. ${pnlInfo}
Ações permitidas agora: ${permitted}.
Preço atual da ação: R$ ${currentPrice.toFixed(2)}.

Regras de dimensionamento (banca pequena, a partir de R$ 100):
- NUNCA emita BUY se caixa disponível for inferior ao preço de 1 ação (R$ ${currentPrice.toFixed(2)}). Se capacidade for 0 ações, escolha HOLD ou SELL.
- "valor_usdt" é o valor financeiro em R$ da ordem:
  * No BUY: informe no máximo R$ ${maxBuyAmountBrl} (de 1 ação até ${maxSharesCanBuy} ações). Ordens acima do caixa disponível serão REJEITADAS pelo motor de risco.
  * No SELL: quanto vender agora em R$ (0 ou valor >= custo da posição encerra tudo; valores intermediários realizam lucro parcial).
- Varie o tamanho das ordens conforme a convicção: sinal moderado = 1 ação; sinal forte com alta confluência = até ${maxSharesCanBuy} ações. Entre escalonado e saia escalonado.

Diretrizes de Trading (Relação Risco:Retorno mínima 2:1):
- BUY: confluência de tendência e volume. Alvo +0,5% a +2,0% com stop ~-0,3% a -0,8%. Pode somar à posição existente se a tese continuar válida e houver caixa.
- SELL: parcial ao atingir alvos intermediários; total ao atingir o alvo final, violar o stop ou perder momentum intradiário. Evite sair por ruído de 1 minuto.
- HOLD: sem assimetria clara de risco/retorno ou quando o caixa for insuficiente para nova compra.

Indicadores e Book da B3: ${JSON.stringify(snapshot)}`;
}

export class OpenRouterClient { constructor(private key: string, private models: string[], private fetchFn: typeof fetch = fetch, private timeoutMs: number = 30_000) {} async decide(prompt: string): Promise<{ decision: AiDecision; usage: AiUsage }> { let lastError='No model attempted'; for(const [index,model] of this.models.entries()){ const started=Date.now(); try { const response=await this.fetchFn('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${this.key}`},body:JSON.stringify({model,messages:[{role:'user',content:prompt}],temperature:0,response_format:{type:'json_object'}}),signal:AbortSignal.timeout(this.timeoutMs)}); if(!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`); const body=await response.json() as {model?:string;choices?:Array<{message?:{content?:string|null}}> ;usage?:{prompt_tokens?:number;completion_tokens?:number;total_tokens?:number;cost?:number}}; const decision=parseAiContent(body.choices?.[0]?.message?.content); if(decision.reason.startsWith('Invalid')||decision.reason==='AI returned empty content') throw new Error(decision.reason); return {decision,usage:{modelRequested:model,modelReturned:body.model??model,promptTokens:body.usage?.prompt_tokens??null,completionTokens:body.usage?.completion_tokens??null,totalTokens:body.usage?.total_tokens??null,costUsd:body.usage?.cost??null,latencyMs:Date.now()-started,error:null,fallbackUsed:index>0}}; } catch(error) { lastError=error instanceof Error?error.message:'Unknown AI error'; } } return {decision:{action:'HOLD',amountUsdt:0,confidence:0,reason:`All OpenRouter fallbacks failed: ${lastError}`,rawResponse:null},usage:{modelRequested:this.models.at(-1)??'none',modelReturned:null,promptTokens:null,completionTokens:null,totalTokens:null,costUsd:null,latencyMs:0,error:lastError,fallbackUsed:this.models.length>1}}; } }
