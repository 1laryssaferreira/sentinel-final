# API do Sentinel

Todas as rotas ficam em `http://localhost:3001/api`. Entrada e saída em JSON.
Rotas marcadas com 🔒 exigem o cabeçalho `Authorization: Bearer <token>`,
recebido no login.

## Login (`backend/src/routes/auth.ts`)

| Método | Rota | O que faz | Respostas |
| --- | --- | --- | --- |
| POST | `/auth/registro` | Cria uma conta. Corpo: `{ nome, email, senha }`. A senha é guardada com hash bcrypt. | 201 conta criada · 400 dados inválidos · 409 e-mail já cadastrado |
| POST | `/auth/login` | Confere e-mail e senha e devolve um token JWT válido por 12 horas. Corpo: `{ email, senha }` | 200 `{ usuario, token }` · 401 e-mail ou senha inválidos |

## Biometria e controle de acesso (`backend/src/routes/acesso.ts`)

| Método | Rota | O que faz | Respostas |
| --- | --- | --- | --- |
| GET | `/controle-acesso/residentes` | Lista os moradores cadastrados (sem o vetor do rosto). | 200 |
| POST | `/controle-acesso/residentes` | Cadastra um morador. Corpo: `{ nome, documentoId?, descritorFacial }` (lista de 128 números; o servidor sempre salva como lista). | 201 · 400 vetor inválido |
| DELETE | `/controle-acesso/residentes/:id` | Remove um morador. O histórico de acessos é mantido (`ON DELETE SET NULL`). | 204 |
| POST | `/controle-acesso/autenticar` | Compara um rosto com todos os moradores pela distância euclidiana. Abaixo de 0,45 é o mesmo rosto (`LIMITE_FACIAL` no `.env`). Se dois moradores ficarem quase igual distantes, nega como ambíguo. Corpo: `{ descritorFacial, origem?, registrar? }` | 200 `{ status: "AUTORIZADO" \| "NEGADO", distancia, limite, motivo? }` · 400 vetor inválido |
| GET | `/controle-acesso/tentativas` | Últimos acessos, com o nome do morador (JOIN entre `tentativas_acesso` e `residentes_autorizados`). | 200 |
| POST | `/controle-acesso/tentativas` | Registra uma tentativa de acesso (usado no "simular procurado"). | 201 |

## Sensores e risco (`backend/src/routes/sensores.ts` e `backend/src/riskEngine.ts`)

| Método | Rota | O que faz | Respostas |
| --- | --- | --- | --- |
| GET | `/sensores` | Estado atual dos sensores e o índice de risco. | 200 `{ estado, risco }` |
| PUT | `/sensores/:campo` | Muda um sensor (`portaPrincipal`, `janelaSala`, `incendioDetectado`, `gasDetectado`). Corpo: `{ estado: true \| false }`. Recalcula o risco; se chegar a 90%, registra o acionamento automático (no máximo um por minuto para cada serviço). | 200 `{ estado, risco }` · 400 sensor desconhecido |

## Eventos (`backend/src/routes/eventos.ts`)

| Método | Rota | O que faz | Respostas |
| --- | --- | --- | --- |
| GET | `/eventos` | Status do sistema e os últimos eventos. | 200 `{ status, totalLogs, logs }` |
| POST | `/eventos` | Registra um evento da casa. Corpo: `{ tipo, status }` | 201 |

## Emergência simulada (`backend/src/routes/acionamento.ts`)

| Método | Rota | O que faz | Respostas |
| --- | --- | --- | --- |
| GET | `/acionamento` | Histórico de chamadas simuladas. | 200 |
| POST | `/acionamento` | Registra uma chamada simulada. Corpo: `{ servico: "POLICIA" \| "BOMBEIROS", motivo, riscoNoMomento?, automatico? }`. **Nenhuma ligação real é feita.** | 201 · 400 |

## Assistente com IA (`backend/src/routes/assistente.ts` e `backend/src/ia.ts`)

| Método | Rota | O que faz | Respostas |
| --- | --- | --- | --- |
| GET | `/assistente/status` | Diz se a IA está ligada, o modelo e o desempenho medido: última latência, média e memória ocupada pelo modelo no Ollama. | 200 |
| POST | `/assistente/chat` 🔒 | Envia a conversa e o estado da casa ao Llama. Resposta: texto, ações para o painel e o tempo gasto. Limite de 20 mensagens por minuto por usuário. | 200 `{ resposta, acoes, modelo, tempoMs }` · 401 sem login · 429 limite · 502/503 IA indisponível |

## Localização e sistema

| Método | Rota | O que faz |
| --- | --- | --- |
| POST | `/localizacao` | Salva a posição da central, enviada pelo navegador. |
| GET | `/localizacao/ultima` | Última posição salva. |
| GET | `/sistema/rede` | IPs do computador, para o QR Code da câmera do celular. |
| GET | `/sistema/saude` | Diz se o servidor e o banco estão no ar. |
| POST | `/leads` | Recebe um formulário de contato (a versão atual do site não usa). |

## Tempo real (Socket.IO)

| Evento | Quando é enviado |
| --- | --- |
| `evento:novo` | Um evento foi registrado |
| `sensores:atualizados` | Um sensor mudou (com o novo risco) |
| `acesso:novo` / `residente:novo` | Houve um acesso ou um morador novo |
| `camera:nova`, `sinal:offer`, `sinal:answer`, `sinal:ice` | Conexão das câmeras de celular (WebRTC) |
