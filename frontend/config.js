// ==========================================================
// Configuração compartilhada por todas as páginas do Sentinel.
//
// Se a página foi aberta pelo próprio back-end (porta 3001 ou 3443),
// a API está na mesma origem. Se foi aberta pelo Live Server (5500)
// ou direto do arquivo, aponta para http://<host>:3001.
// ==========================================================
(function () {
  const { protocol, hostname, port, origin } = window.location;
  // Publicado na internet (https://seu-site.com, sem porta) ou aberto pelo
  // próprio back-end (3001/3443): a API está na mesma origem.
  // Live Server (5500) ou arquivo aberto direto: aponta para :3001.
  const servidoPeloBackend = port === '3001' || port === '3443' || (port === '' && protocol.startsWith('http'));
  const host = hostname || 'localhost';
  const base = servidoPeloBackend ? origin : `http://${host}:3001`;

  window.SENTINEL = {
    origem: base,
    api: `${base}/api`,
    sala: 'sentinel-casa',
    versao: '3.0'
  };
})();
