// Modo "calibração de porta": quando o técnico vai desligar uma porta física de
// propósito (pra ver quem cai e descobrir quem está nela), ele avisa o sistema
// aqui. Enquanto ativo, a gente não dispara alerta de "queda em massa" (já se
// sabe a causa) e o admin consegue aplicar a porta certa em lote pra todo mundo
// que caiu durante a janela, em vez de marcar cliente por cliente.
let active = null; // { port, startedAt }

export function startCalibration(port) {
  active = { port, startedAt: new Date().toISOString() };
  return active;
}

export function stopCalibration() {
  const previous = active;
  active = null;
  return previous;
}

export function getActiveCalibration() {
  return active;
}
