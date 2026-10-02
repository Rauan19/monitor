# MonitorZcnet (app Android)

App Expo/React Native que espelha o painel web: clientes online/offline, histórico, saúde do CCR, estatísticas, e a ficha de cada cliente. Fala com o mesmo backend Express da pasta `server/` (nenhuma rota nova de dado, só autenticação por token e notificação push).

## O que tem

- Login com token (não usa cookie, guarda o token no `AsyncStorage` e manda `Authorization: Bearer`)
- Endereço do servidor configurável na tela de login/ajustes (não é fixo no app). Veja "Trocar o endereço do servidor" abaixo
- Abas: **Clientes** (Todos/Online/Offline com busca), **Histórico**, **Sistema**, **Estatísticas**, **Ajustes**
- Ficha do cliente com edição de apelido/localização/porta e remoção
- Relatório mensal abre no navegador do celular (usa um token de uso único na URL)
- **Notificação push**: queda em massa (3+ clientes da mesma porta ONT ou região caindo numa janela curta) e CCR fora do ar / voltando. `OUTAGE_ALERT_*` no `.env` do servidor controla limite/janela/cooldown
- Aba **Alertas** com o histórico dos pushes, mostrando a porta/região, o percentual e quais clientes caíram. Tocar numa notificação abre direto nessa aba, inclusive com o app fechado
- **Enviar push de teste** em Ajustes, pra conferir a corrente toda sem esperar uma queda real

## Rodar em desenvolvimento

```bash
cd app
npm install
npx expo start
```

Abra no celular com o app **Expo Go** (escaneando o QR code), mas repare: **notificação push só funciona em build nativo (EAS), não no Expo Go** pra projetos com `projectId` configurado depois do SDK 53. Pra testar push de verdade, já parta direto pro build de desenvolvimento (`eas build --profile development`).

Na tela de login, informe o endereço do servidor, por exemplo:

```
http://192.168.0.10:3001
```

(o celular precisa alcançar esse IP: mesma rede Wi-Fi, ou VPN/porta liberada se for acessar de fora).

## Trocar o endereço do servidor

Tem **dois** lugares onde o endereço vive:

1. **Padrão de fábrica**: [`src/defaultServer.js`](src/defaultServer.js). É o que o app usa na primeira instalação, antes de qualquer login:
   ```js
   export const DEFAULT_SERVER_URL = 'https://apimonitor.zcnetprovedor.com.br';
   ```
   Se o domínio mudar, troque essa constante e gere um build novo, ou:
2. **Dentro do app**: tela de **Login** (antes de entrar) ou **Ajustes > Servidor** (já logado). O que for salvo aí manda no aparelho, sobrescrevendo o padrão de fábrica, e não precisa rebuildar o app pra trocar de servidor no dia a dia.

> **Atenção:** o EAS Build só envia arquivos rastreados pelo git. Trocar a constante sem commitar faz o build sair com o endereço antigo.


## Ícone e splash screen

Gerados em `assets/` (ícone com "sinal de rede" nas cores do app):

- `icon.png`: ícone quadrado (Play Store / launcher legado)
- `android-icon-foreground.png` / `android-icon-background.png` / `android-icon-monochrome.png`: ícone adaptativo do Android (inclusive o modo monocromático do Android 13+)
- `splash-icon.png`: tela de abertura, configurada em `app.json` via plugin `expo-splash-screen` (fundo `#09090b`, ícone centralizado)

Pra trocar, é só substituir os PNGs em `assets/` mantendo os mesmos nomes (1024×1024, fundo transparente nas versões foreground/monochrome/splash) e rodar o build de novo.

## Build do APK nesta máquina

```bash
cd app
node scripts/build-apk.mjs
```

Sai em `app/build/MonitorZcnet-<versão>.apk`, pronto pra instalar. Não gasta cota
de build do Expo e não depende de login na Expo.

Precisa ter instalado: **JDK 17** e o **Android SDK** (plataforma 36, build-tools
36, NDK). Quem tem Android Studio já tem tudo; o script acha o SDK sozinho nos
lugares de sempre, ou respeita `ANDROID_HOME` se você apontar.

Não existe `.env` no app: o endereço da API fica fixo em
`src/defaultServer.js` e o `google-services.json` é lido na hora do build. Nada
precisa ser injetado, o APK já sai com tudo dentro.

O que o script faz, nessa ordem: sobe o `versionCode`, roda `expo prebuild`,
aplica a assinatura de release e compila com Gradle. Ele reaplica os ajustes a
cada execução de propósito, porque o `prebuild` reescreve `android/` do zero a
partir do `app.json`.

### Assinatura

Na primeira vez o script gera `monitorzcnet-release.jks` e grava a senha em
`android-signing.properties`. Os dois ficam fora do git.

**Guarde esse par.** Android só instala uma atualização por cima de um app se a
assinatura for a mesma. Se perder, todo APK futuro vira "app diferente" e só
instala desinstalando o que está no celular antes.

O template do Expo, por padrão, assina o release com a keystore de **debug**,
cuja senha (`android`) é a mesma em qualquer máquina do mundo. Pra um app que
guarda sessão de admin do provedor isso não serve, por isso a keystore própria.

### Vindo de um APK do EAS

A assinatura local é diferente da que o EAS usava, então o Android recusa a
instalação por cima. **Desinstale o MonitorZcnet antes** de instalar o primeiro
APK local. Daí em diante as atualizações instalam normal, uma sobre a outra.

### Build na nuvem (alternativa)

Continua funcionando, se um dia preferir:

```bash
eas build --platform android --profile preview
```

## Notificações push: como funciona

1. No app, em **Ajustes → Ativar notificações**, o app pede permissão, pega o Expo push token e registra no servidor (`POST /api/push/register`).
2. O servidor guarda o token no SQLite (`push_tokens`).
3. A cada leitura do CCR, se 3+ clientes da mesma porta ou região caíram nos últimos minutos (`OUTAGE_ALERT_WINDOW_MINUTES`), o grupo entra em **observação**, sem avisar nada ainda. Passados `OUTAGE_ALERT_CONFIRM_MINUTES`, o servidor reconfere quantos daquele grupo **continuam** fora: se ainda forem 3+, dispara o push via Expo Push API; quem voltou no meio sai da conta em silêncio. Depois disso o grupo fica em `OUTAGE_ALERT_COOLDOWN_MINUTES` de cooldown.

   A espera existe porque a maioria das quedas é curta: ONT que reiniciou, piscada de energia, cliente mexendo no roteador. Avisar na hora enchia o celular de alerta de coisa já resolvida. O preço é a queda real avisar com esses minutos de atraso.

   **Não existe push de "CCR fora do ar".** Qualquer leitura lenta que estourava o timeout caía no mesmo caminho da queda, e com mil sessões PPPoE isso acontece direto: avisava por ciclo ruim, não por queda. A queda do CCR continua no status do painel, no histórico e no webhook. Queda de **link de transporte** cadastrado, essa sim, gera push furando a fila.
3.1. Todo push fica gravado no histórico e aparece na aba **Alertas**. Tocar na notificação abre o app nessa aba.
3.2. No **logout** o token é removido do servidor, pra o aparelho deslogado parar de receber alertas.
4. Limiares configuráveis no `.env` do servidor:
   ```env
   OUTAGE_ALERT_THRESHOLD=3
   OUTAGE_ALERT_WINDOW_MINUTES=5
   OUTAGE_ALERT_CONFIRM_MINUTES=5
   OUTAGE_ALERT_COOLDOWN_MINUTES=30
   ```

   Pra conferir que a espera funciona: `cd server && node scripts/testar-alerta-queda.mjs`

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
