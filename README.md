# MonitorZcnet (app Android)

App Expo/React Native que espelha o painel web: clientes online/offline, histórico, saúde do CCR, estatísticas, e a ficha de cada cliente. Fala com o mesmo backend Express da pasta `server/` (nenhuma rota nova de dado — só autenticação por token e notificação push).

## O que tem

- Login com token (não usa cookie — guarda o token no `AsyncStorage` e manda `Authorization: Bearer`)
- Endereço do servidor configurável na tela de login/ajustes (não é fixo no app) — veja "Trocar o endereço do servidor" abaixo
- Abas: **Clientes** (Todos/Online/Offline com busca), **Histórico**, **Sistema**, **Estatísticas**, **Ajustes**
- Ficha do cliente com edição de apelido/localização/porta e remoção
- Relatório mensal abre no navegador do celular (usa um token de uso único na URL)
- **Notificação push de queda em massa**: quando 3+ clientes da mesma porta ONT ou da mesma região caem dentro de uma janela curta de tempo, o servidor manda um push (`OUTAGE_ALERT_*` no `.env` do servidor controla o limite/janela/cooldown)

## Rodar em desenvolvimento

```bash
cd app
npm install
npx expo start
```

Abra no celular com o app **Expo Go** (escaneando o QR code) — mas repare: **notificação push só funciona em build nativo (EAS), não no Expo Go** pra projetos com `projectId` configurado depois do SDK 53. Pra testar push de verdade, já parta direto pro build de desenvolvimento (`eas build --profile development`).

Na tela de login, informe o endereço do servidor, por exemplo:

```
http://192.168.0.10:3001
```

(o celular precisa alcançar esse IP — mesma rede Wi-Fi, ou VPN/porta liberada se for acessar de fora).

## Trocar o endereço do servidor

Tem **dois** lugares onde o endereço vive:

1. **Padrão de fábrica** — [`src/defaultServer.js`](src/defaultServer.js). É o que o app usa na primeira instalação, antes de qualquer login. Hoje está apontando pro túnel do ngrok:
   ```js
   export const DEFAULT_SERVER_URL = 'https://b47b-170-81-63-98.ngrok-free.app';
   ```
   Troque essa constante sempre que o link do ngrok mudar (o free tier gera um link novo a cada vez que você reinicia o `ngrok http`) e gere um novo build, ou:
2. **Dentro do app** — tela de **Login** (antes de entrar) ou **Ajustes → Servidor** (já logado). O que for salvo aí manda no aparelho, sobrescrevendo o padrão de fábrica — não precisa rebuildar o app pra trocar de servidor no dia a dia.

Como é ngrok free, toda requisição do app já manda o header `ngrok-skip-browser-warning` (em `src/api.js`) — sem isso o ngrok devolve uma página HTML de aviso em vez do JSON da API e o app quebraria.

## Ícone e splash screen

Gerados em `assets/` (ícone com "sinal de rede" nas cores do app):

- `icon.png` — ícone quadrado (Play Store / launcher legado)
- `android-icon-foreground.png` / `android-icon-background.png` / `android-icon-monochrome.png` — ícone adaptativo do Android (inclusive o modo monocromático do Android 13+)
- `splash-icon.png` — tela de abertura, configurada em `app.json` via plugin `expo-splash-screen` (fundo `#09090b`, ícone centralizado)

Pra trocar, é só substituir os PNGs em `assets/` mantendo os mesmos nomes (1024×1024, fundo transparente nas versões foreground/monochrome/splash) e rodar o build de novo.

## Antes de buildar o APK

1. **Instale o EAS CLI** (uma vez): `npm install -g eas-cli`
2. **Login na Expo**: `eas login`
3. **Vincule o projeto** — já feito (`extra.eas.projectId` em `app.json` já está preenchido). Se precisar refazer:
   ```bash
   cd app
   eas init
   ```
4. **Configure o build Android** (se ainda não existir `eas.json`):
   ```bash
   eas build:configure
   ```

## Build do APK

```bash
cd app
eas build --platform android --profile preview
```

Isso builda um `.apk` direto instalável (não precisa de loja). Se preferir gerar localmente sem depender dos servidores da Expo (precisa de Android SDK instalado):

```bash
npx expo run:android --variant release
```

O nome do app já está configurado como **MonitorZcnet** (`app.json` → `name`/`android.package`).

## Notificações push — como funciona

1. No app, em **Ajustes → Ativar notificações**, o app pede permissão, pega o Expo push token e registra no servidor (`POST /api/push/register`).
2. O servidor guarda o token no SQLite (`push_tokens`).
3. A cada leitura do CCR, se algum cliente caiu, o servidor verifica se 3+ clientes da mesma porta ou região caíram nos últimos minutos (`OUTAGE_ALERT_WINDOW_MINUTES`) e ainda não foi avisado recentemente (`OUTAGE_ALERT_COOLDOWN_MINUTES`) — se sim, dispara o push pra todos os tokens registrados via Expo Push API.
4. Limiares configuráveis no `.env` do servidor:
   ```env
   OUTAGE_ALERT_THRESHOLD=3
   OUTAGE_ALERT_WINDOW_MINUTES=5
   OUTAGE_ALERT_COOLDOWN_MINUTES=30
   ```

Isso só funciona se os clientes já tiverem **porta** ou **região** cadastrados (edite isso na ficha do cliente, tanto no app quanto no painel web).

## Estrutura

```
app/
  App.js                  navegação (tabs + stack)
  src/
    api.js                cliente HTTP (mesmos endpoints do web)
    storage.js             AsyncStorage: servidor, token, usuário
    notifications.js       registro de push (expo-notifications)
    context/AuthContext.js sessão (login/logout/checagem inicial)
    theme.js / format.js   cores e formatação (mesma paleta do web)
    components/            Badge, Card, Pager, ClientRow, MiniBars…
    screens/                Login, Clientes, Histórico, Sistema, Estatísticas, Ajustes, ClientDetail
```
