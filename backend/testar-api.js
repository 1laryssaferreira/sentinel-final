// ==========================================================
// TESTES AUTOMATIZADOS DA API DO SENTINEL
// Rode com o servidor ligado (npm run dev), em outro terminal:
//   npm test
// Cada teste chama uma rota real e confere a resposta.
// ==========================================================
const API = process.env.API_URL || 'http://localhost:3001/api';
let passou = 0, falhou = 0;

async function chamar(metodo, rota, corpo, token) {
  const resposta = await fetch(API + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const dados = resposta.status === 204 ? null : await resposta.json().catch(() => null);
  return { codigo: resposta.status, dados };
}

function conferir(descricao, condicao, detalhe = '') {
  if (condicao) { passou++; console.log(`  ✅ ${descricao}`); }
  else { falhou++; console.log(`  ❌ ${descricao} ${detalhe}`); }
}

// Dois "rostos" de teste: vetores de 128 números bem diferentes entre si.
const rostoMorador = Array.from({ length: 128 }, (_, i) => Math.sin(i) * 0.1);
const rostoEstranho = Array.from({ length: 128 }, (_, i) => Math.cos(i) * 0.5 + 0.3);

async function executar() {
  console.log(`\n🧪 Testando a API em ${API}\n`);

  console.log('Login e segurança');
  const login = await chamar('POST', '/auth/login', { email: 'operador@sentinel.com', senha: 'Sentinel123' });
  conferir('login com a conta de teste devolve um token JWT', login.codigo === 200 && !!login.dados?.token, `(código ${login.codigo})`);
  const token = login.dados?.token;
  const senhaErrada = await chamar('POST', '/auth/login', { email: 'operador@sentinel.com', senha: 'errada123' });
  conferir('senha errada é recusada com 401', senhaErrada.codigo === 401);
  const semToken = await chamar('POST', '/assistente/chat', { mensagens: [{ papel: 'usuario', texto: 'oi' }] });
  conferir('assistente sem login é recusado com 401 (middleware)', semToken.codigo === 401);

  console.log('\nBiometria facial');
  const cadastro = await chamar('POST', '/controle-acesso/residentes', { nome: 'Morador de teste', descritorFacial: rostoMorador });
  conferir('cadastrar morador com vetor de 128 números', cadastro.codigo === 201, `(código ${cadastro.codigo})`);
  const mesmoRosto = await chamar('POST', '/controle-acesso/autenticar', { descritorFacial: rostoMorador, registrar: false });
  conferir('o mesmo rosto é AUTORIZADO (distância < 0,45)', mesmoRosto.dados?.status === 'AUTORIZADO', JSON.stringify(mesmoRosto.dados));
  const outroRosto = await chamar('POST', '/controle-acesso/autenticar', { descritorFacial: rostoEstranho, registrar: false });
  conferir('um rosto diferente é NEGADO', outroRosto.dados?.status === 'NEGADO', JSON.stringify(outroRosto.dados));
  const vetorInvalido = await chamar('POST', '/controle-acesso/autenticar', { descritorFacial: [1, 2, 3] });
  conferir('vetor com tamanho errado é recusado com 400', vetorInvalido.codigo === 400);

  // Caso da apresentação: outra pessoa com rosto PARECIDO (distância 0,48).
  // Com o limite antigo (0,5) ela entraria com o nome do morador.
  const rostoParecido = rostoMorador.map(v => v + 0.0424); // 0,0424 × √128 ≈ 0,48
  const parecido = await chamar('POST', '/controle-acesso/autenticar', { descritorFacial: rostoParecido, registrar: false });
  conferir('rosto parecido, mas a 0,48 de distância, é NEGADO (limite 0,45)', parecido.dados?.status === 'NEGADO', JSON.stringify(parecido.dados));

  // Dois moradores quase iguais: um rosto no meio dos dois não pode ser "chutado".
  const gemeo = rostoMorador.map(v => v + 0.004); // a ≈ 0,045 do primeiro morador
  const cadastroGemeo = await chamar('POST', '/controle-acesso/residentes', { nome: 'Morador parecido', descritorFacial: gemeo });
  const meio = rostoMorador.map(v => v + 0.002);
  const ambiguo = await chamar('POST', '/controle-acesso/autenticar', { descritorFacial: meio, registrar: false });
  conferir('rosto igualmente parecido com dois moradores é NEGADO como ambíguo', ambiguo.dados?.status === 'NEGADO' && ambiguo.dados?.motivo === 'AMBIGUO', JSON.stringify(ambiguo.dados));
  if (cadastroGemeo.dados?.id) await chamar('DELETE', `/controle-acesso/residentes/${cadastroGemeo.dados.id}`);

  // ERRO DA APRESENTAÇÃO: o navegador enviava o vetor como objeto {"0":..,"1":..}.
  // Salvo assim, a distância dava 0 e QUALQUER rosto virava a primeira pessoa cadastrada.
  const comoObjeto = Object.fromEntries(rostoMorador.map((v, i) => [i, v]));
  await chamar('DELETE', `/controle-acesso/residentes/${cadastro.dados?.id}`);
  const cadastroObjeto = await chamar('POST', '/controle-acesso/residentes', { nome: 'Cadastro em formato de objeto', descritorFacial: comoObjeto });
  const outraPessoa = await chamar('POST', '/controle-acesso/autenticar', { descritorFacial: rostoEstranho, registrar: false });
  conferir('vetor salvo como objeto: outra pessoa continua NEGADA (erro da apresentação)', outraPessoa.dados?.status === 'NEGADO', JSON.stringify(outraPessoa.dados));
  const mesmaPessoa = await chamar('POST', '/controle-acesso/autenticar', { descritorFacial: rostoMorador, registrar: false });
  conferir('vetor salvo como objeto: a própria pessoa continua AUTORIZADA', mesmaPessoa.dados?.status === 'AUTORIZADO', JSON.stringify(mesmaPessoa.dados));
  if (cadastroObjeto.dados?.id) await chamar('DELETE', `/controle-acesso/residentes/${cadastroObjeto.dados.id}`);

  console.log('\nSensores e índice de risco');
  const portaAberta = await chamar('PUT', '/sensores/portaPrincipal', { estado: true });
  conferir('porta aberta: risco vai de 10% para 35%', portaAberta.dados?.risco === 35, `(risco ${portaAberta.dados?.risco})`);
  const portaFechada = await chamar('PUT', '/sensores/portaPrincipal', { estado: false });
  conferir('porta fechada: risco volta para 10%', portaFechada.dados?.risco === 10, `(risco ${portaFechada.dados?.risco})`);

  console.log('\nEventos');
  const evento = await chamar('POST', '/eventos', { tipo: 'Teste automatizado', status: 'API funcionando' }, token);
  conferir('registrar um evento no MySQL', evento.codigo === 201, `(código ${evento.codigo})`);

  // Limpeza: remove o morador criado pelo teste
  if (cadastro.dados?.id) await chamar('DELETE', `/controle-acesso/residentes/${cadastro.dados.id}`, null, token);

  console.log(`\n${falhou ? '❌' : '✅'} ${passou} testes passaram, ${falhou} falharam.\n`);
  process.exit(falhou ? 1 : 0);
}

executar().catch(erro => {
  console.error('❌ Não foi possível falar com o servidor. Ele está ligado (npm run dev)?', erro.message);
  process.exit(1);
});
