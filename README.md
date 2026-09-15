# Monitor MikroTik (CCR1036)

Painel web **somente leitura** que acompanha sessões PPPoE do MikroTik. Quando um cliente some de `/ppp/active`, o sistema registra a desconexão com horário, algo que o Winbox não guarda.

## O que faz

- Lê `/ppp/active` via API RouterOS (porta 8728)
- Compara a cada ~10s quem entrou / saiu
- Mostra online agora, desconectados (24h) e histórico pesquisável
- Aba **Sistema**: CPU/memória/temperatura do CCR (com gráfico), interfaces, wireless, leases DHCP, filas simples e log do RouterOS (com filtro por tópico)
- Aba **Estatísticas**: ranking de consumo de banda, uptime estimado por cliente, uptime médio por porta/OLT, horário de pico (7 dias), alerta de uso fora do padrão e comparação entre limite contratado (fila) e uso real
- Clique num cliente pra abrir a ficha dele: localização, porta, gráfico de banda, uptime e eventos recentes
- Relatório mensal imprimível (Ctrl+P → salvar como PDF)
- Exportação CSV de desconexões e histórico de eventos
- Webhook opcional (Telegram/Slack/n8n) quando o CCR cai/volta a responder
- App Android nativo (**MonitorZcnet**, pasta `app/`) com as mesmas telas + notificação push de queda em massa e de CCR fora do ar. Veja [app/README.md](app/README.md)
- **Não altera nada** no CCR (só `print`)

## Pré-requisito no MikroTik

Crie um usuário com grupo `read` (não use admin):

```routeros
/user group add name=monitor_read policy=read,api,!local,!telnet,!ssh,!ftp,!reboot,!write,!policy,!test,!winbox,!password,!web,!sniff,!sensitive,!romon
/user add name=monitor group=monitor_read password="SENHA_FORTE"
/ip service enable api
```

Confirme que a API está liberada na rede de onde o monitor vai rodar (`/ip service print` → `api`).

## Configuração

```bash
cp .env.example .env
```

Edite o `.env`:

```env
MIKROTIK_HOST=IP_DO_CCR
MIKROTIK_PORT=8728
MIKROTIK_USER=monitor
MIKROTIK_PASSWORD=SENHA_FORTE
POLL_INTERVAL_MS=10000
PORT=3001
```

## Como rodar

Na pasta do projeto:

```bash
npm install
cd server && npm install && cd ..
cd web && npm install && cd ..
```

Copie e edite o `.env` com o IP real do CCR:

```bash
copy .env.example .env
```

Depois:

```bash
npm run dev
```

- Painel: http://localhost:5173  
- API: http://localhost:3001/api/dashboard  

Produção (build do front servido pelo Express):

```bash
npm run build
npm start
```

## API

| Rota | Descrição |
|------|-----------|
| `GET /api/status` | Status da conexão com o CCR |
| `GET /api/dashboard` | Contadores |
| `GET /api/online` | Sessões online |
| `GET /api/disconnected?hours=24` | Quem caiu |
| `GET /api/events?q=&type=` | Histórico |
| `GET /api/system` | CPU, memória, uptime, temperatura/voltagem (leitura ao vivo) |
| `GET /api/system/history?hours=24` | Histórico de CPU/memória para gráfico |
| `GET /api/interfaces` | Estado e erros/drops de todas as interfaces |
| `GET /api/dhcp-leases?q=` | Leases DHCP ativos |
| `GET /api/queues` | Filas simples (limite contratado x uso) |
| `GET /api/wireless` | Clientes wireless registrados (sinal/CCQ) |
| `GET /api/logs?q=&hours=` | Log do RouterOS (persistido, porque o buffer do CCR é circular) |
| `GET /api/bandwidth-history?client=&hours=` | Série histórica de banda de um cliente |
| `GET /api/top-consumers?hours=&limit=` | Ranking de consumo médio de banda |
| `GET /api/sla?days=30&q=` | Uptime estimado por cliente, baseado nos eventos registrados |
| `GET /api/sla/by-port?days=30` | Uptime médio agrupado por porta/OLT |
| `GET /api/logs/topics` | Tópicos distintos já vistos no log (pro filtro) |
| `GET /api/hourly-load?days=7` | Carga média por hora do dia (horário de pico) |
| `GET /api/anomalies?hours=168` | Clientes com uso atual muito acima da própria média histórica |
| `GET /api/queue-usage?hours=24` | Cruza limite contratado (fila) com uso médio real por cliente |
| `GET /api/client-detail?sessionKey=` | Ficha completa de um cliente (sessão, eventos, banda, SLA) |
| `GET /api/export/disconnected.csv?hours=` | Exporta desconexões em CSV |
| `GET /api/export/events.csv?hours=&type=` | Exporta histórico de eventos em CSV |
| `GET /api/report/monthly?days=30` | Relatório em HTML pronto pra imprimir/salvar como PDF |
| `GET /api/links` | Situação de cada link vigiado (de pé/caído, desde quando, quedas em 24h) |
| `GET /api/links/available` | Interfaces do CCR ainda não vigiadas (pro cadastro) |
| `POST /api/links` | Passa a vigiar uma interface (`{name, label}`) |
| `DELETE /api/links/:name` | Para de vigiar |
| `GET /api/links/events?hours=&name=` | Histórico de quedas, voltas e piscadas |
| `POST /api/push/register` | Registra um Expo push token (app mobile) |
| `POST /api/push/unregister` | Remove um Expo push token |
| `POST /api/push/test` | Dispara um push de teste (corpo opcional `{token}`) |
| `GET /api/notifications` | Histórico de alertas já enviados |

Dados ficam em `server/data/monitor.db` (SQLite). Histórico de sistema/banda/log é limpo automaticamente após `RETENTION_DAYS` (padrão 30 dias).

### Webhook

Se `WEBHOOK_URL` estiver definido no `.env`, o servidor faz um `POST` em JSON pra essa URL quando o CCR fica inacessível e quando volta a responder (`{"type":"ccr_down"|"ccr_up", ...}`). Com `WEBHOOK_NOTIFY_CLIENTS=true`, também notifica conexões/desconexões de clientes PPPoE (`{"type":"client_events", "connected":[...], "disconnected":[...]}`). Funciona bem com um webhook do Telegram (via bot) ou Slack incoming webhook.

### Notificação push (app MonitorZcnet)

O servidor manda push pra todos os celulares com o app instalado e pros navegadores com notificação ativada nestes casos:

- **Queda em massa**: 3+ clientes da mesma porta ONT ou da mesma região caem juntos numa janela curta. Útil pra pegar queda de OLT/porta antes do cliente ligar reclamando
- **CCR fora do ar / voltou**: quando o próprio CCR para de responder e quando volta (fura a fila, por ser mais grave que um alerta de porta)

Só avisa a queda do CCR se ele *estava* respondendo antes. Se o servidor subiu e nunca conseguiu conectar, isso é configuração errada, não queda, e não dispara push.

Configurável no `.env`:

```env
OUTAGE_ALERT_THRESHOLD=3            # mínimo de clientes caídos no grupo
OUTAGE_ALERT_PERCENT=0.5            # e pelo menos 50% do grupo (0..1)
OUTAGE_ALERT_WINDOW_MINUTES=5       # janela onde as quedas contam como "juntas"
OUTAGE_ALERT_COOLDOWN_MINUTES=30    # não repete o alerta da mesma porta/região antes disso
OUTAGE_ALERT_GAP_MS=60000           # espaçamento entre pushes quando vários alertas disparam juntos
```

Todo push também fica gravado no histórico, visível na aba **Notificações** do painel e na aba **Alertas** do app.

#### Testar sem esperar uma queda

No painel web (**Enviar push de teste**, ao lado do botão de notificações) ou no app (**Ajustes → Notificações push → Enviar push de teste**). Manda um push só pro aparelho que pediu e grava no histórico, então prova a corrente toda de uma vez: credencial do Firebase, token registrado, permissão no aparelho e escrita no banco. Pela API:

```
POST /api/push/test        # sem corpo: manda pra todos os dispositivos
POST /api/push/test        # {"token":"..."}: manda só pra esse
```

### Monitoramento de links (uplink, POP, torre)

Antes, queda de link era descoberta por dedução: o alerta de queda em massa disparava quando vários clientes da mesma porta caíam juntos. Isso diz que algo quebrou, mas não o quê, e só depois dos clientes cairem.

Agora o poller lê `/interface print` a cada ciclo e avisa na hora:

- **Link caiu / voltou**: a interface saiu de `running`. Gera push com prioridade e entra no histórico.
- **Link piscou**: o contador `link-downs` do RouterOS subiu mas a interface está de pé (caiu e voltou entre duas leituras). Fica registrado sem gerar push: link que pisca é fibra ruim ou rádio instável, e é o tipo de coisa que passa despercebida.

Só as interfaces **cadastradas** geram alerta. O CCR tem centenas de interfaces e cada PPPoE de cliente é uma delas: vigiar todas seria só ruído. Cadastre em **Links → Cadastrar link** (no painel ou no app), dando um apelido a cada uma (`Uplink Vivo`, `Torre Norte`). As PPPoE de cliente já ficam fora da lista de escolha.

Uma queda nova só é considerada a partir da segunda leitura: link que já estava caído antes do servidor subir não gera alerta.

**Limite conhecido:** interface de pé não garante que o equipamento do outro lado está vivo (fibra ok, rádio remoto morto). Para isso é preciso ping, e o usuário do monitor é somente leitura (`!test`). O caminho nesse caso é o netwatch do RouterOS — você cadastra no CCR (precisa de `write`, então é via Winbox) e o monitor lê o resultado:

```routeros
/tool netwatch add host=10.0.0.2 interval=30s comment="POP Centro"
```

### Autenticação

O painel web usa cookie de sessão (`HttpOnly`). O app mobile usa o mesmo login, mas manda o token por `Authorization: Bearer <token>` (o `/api/login` devolve o token no corpo da resposta pra isso). Ambos aceitos ao mesmo tempo pelo servidor.
