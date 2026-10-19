// Ultima resposta boa de cada consulta, guardada no navegador.
//
// Pra que: o painel so desenhava depois que a rede respondia. Mesmo com o
// servidor indo bem, sao o download do bundle mais uma ida e volta por
// consulta antes de aparecer qualquer numero, e nesse meio tempo a tela fica
// em "Carregando...". Quem abre o painel varias vezes por dia ve essa espera
// toda vez, e e isso que da a sensacao de lento.
//
// Com o guardado, a tela abre PREENCHIDA com o que se sabia da ultima vez e se
// corrige sozinha quando a resposta chega. O banco nao tem nada a ver com isso:
// as consultas custam menos de 1ms cada; o tempo e a viagem ate o servidor.
//
// Mesma ideia do cache do app (app/src/cache.js), inclusive a validade: dado
// velho demais nao descreve mais a rede e e pior que tela vazia.

const PREFIXO = 'monitorzcnet:cache:';

// Acima disso o guardado nao serve mais. Uma tela dizendo quem esta online com
// dado de ontem mente; melhor abrir vazia e esperar a resposta.
const VALIDADE_MS = 12 * 60 * 60 * 1000;

// localStorage costuma ter ~5 MB por origem. Uma pagina de 20 clientes e
// pequena, mas nao vale arriscar estourar a cota e quebrar o resto do painel.
const MAX_BYTES = 256 * 1024;

export function lerCache(chave) {
  try {
    const bruto = localStorage.getItem(PREFIXO + chave);
    if (!bruto) return null;
    const dados = JSON.parse(bruto);
    if (!dados || typeof dados.em !== 'number') return null;
    if (Date.now() - dados.em > VALIDADE_MS) {
      localStorage.removeItem(PREFIXO + chave);
      return null;
    }
    return dados.valor;
  } catch {
    return null;
  }
}

export function gravarCache(chave, valor) {
  try {
    const bruto = JSON.stringify({ valor, em: Date.now() });
    if (bruto.length > MAX_BYTES) return;
    localStorage.setItem(PREFIXO + chave, bruto);
  } catch {
    // cota cheia ou modo privado: guardar e otimizacao, nunca requisito
  }
}

export function limparCache() {
  try {
    for (const chave of Object.keys(localStorage)) {
      if (chave.startsWith(PREFIXO)) localStorage.removeItem(chave);
    }
  } catch {
    // ignora
  }
}
