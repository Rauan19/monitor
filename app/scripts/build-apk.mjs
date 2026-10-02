/**
 * Gera o APK de release do MonitorZcnet nesta maquina, sem gastar cota do EAS.
 *
 *   cd app && node scripts/build-apk.mjs
 *
 * Precisa de JDK 17 e do Android SDK (plataforma 36, build-tools 36, NDK). O
 * script acha o SDK sozinho nos lugares de sempre do Windows/macOS/Linux.
 *
 * Por que um script e nao um punhado de comandos no README: `expo prebuild`
 * reescreve android/ a partir do app.json a cada execucao, e o template do
 * Expo assina o release com a keystore de DEBUG (senha publica "android").
 * Entao as duas coisas que o build precisa, assinatura propria e ABIs de
 * celular, teriam que ser refeitas a mao toda vez. Aqui elas sao reaplicadas
 * depois do prebuild, sempre, e o resultado nao depende de ninguem lembrar.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const ANDROID = path.join(RAIZ, 'android');
const KEYSTORE = path.join(RAIZ, 'monitorzcnet-release.jks');
const SENHAS = path.join(RAIZ, 'android-signing.properties');
const ALIAS = 'monitorzcnet';

// Só o que celular usa. O padrão do template inclui x86 e x86_64, que servem
// para emulador: compilar os quatro dobra o tempo e o tamanho do APK por nada.
const ABIS = 'arm64-v8a,armeabi-v7a';

const passo = (t) => console.log(`\n── ${t}`);
const nota = (t) => console.log(`   ${t}`);

function rodar(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: RAIZ, ...opts });
}

/**
 * Executavel .cmd/.bat no Windows (npx, gradlew) precisa de shell: desde o Node
 * 20 o spawn direto devolve EINVAL. Fora do Windows nao muda nada.
 */
function rodarScript(cmd, args, opts = {}) {
  const comShell = process.platform === 'win32';
  // Com shell, o caminho vira texto da linha de comando e precisa de aspas por
  // causa de espaco em pasta ("Program Files", "Meus Documentos").
  rodar(comShell ? `"${cmd}"` : cmd, args, { shell: comShell, ...opts });
}

/** Onde o Android SDK costuma estar, em ordem. */
function acharSdk() {
  const doAmbiente = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const candidatos = [
    doAmbiente,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    path.join(os.homedir(), 'Android', 'Sdk'),
  ].filter(Boolean);

  for (const dir of candidatos) {
    if (fs.existsSync(path.join(dir, 'platforms'))) return dir;
  }
  console.error(
    '\nNao achei o Android SDK. Instale o Android Studio ou aponte ANDROID_HOME\n' +
      'pra pasta do SDK e rode de novo. Procurei em:\n' +
      candidatos.map((c) => '  ' + c).join('\n')
  );
  process.exit(1);
}

/**
 * Keystore de release. A de debug que vem no template tem senha publica
 * ("android", alias "androiddebugkey"), igual em toda maquina do mundo: um APK
 * de terceiro assinado com ela se instalaria por cima deste como se fosse
 * atualizacao, e o app guarda sessao de admin do provedor.
 *
 * A senha fica em android-signing.properties, fora do git. Guarde os dois
 * arquivos: sem eles, um APK futuro tem assinatura diferente e o Android
 * recusa instalar por cima do que esta no celular (precisa desinstalar).
 */
function garantirKeystore() {
  if (fs.existsSync(KEYSTORE) && fs.existsSync(SENHAS)) {
    nota('keystore de release ja existe, reaproveitando');
    return;
  }
  if (fs.existsSync(KEYSTORE) !== fs.existsSync(SENHAS)) {
    console.error(
      `\nAchei so metade do par de assinatura:\n` +
        `  keystore: ${fs.existsSync(KEYSTORE) ? 'existe' : 'FALTA'}  ${KEYSTORE}\n` +
        `  senha:    ${fs.existsSync(SENHAS) ? 'existe' : 'FALTA'}  ${SENHAS}\n` +
        `\nOs dois andam juntos. Se perdeu a senha, apague a keystore e rode de novo\n` +
        `(o APK novo nao vai instalar por cima do antigo, vai precisar desinstalar).`
    );
    process.exit(1);
  }

  nota('gerando keystore de release (primeira vez)');
  const senha = crypto.randomBytes(24).toString('base64url');
  rodar('keytool', [
    '-genkeypair',
    '-v',
    '-keystore', KEYSTORE,
    '-alias', ALIAS,
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10000',
    '-storepass', senha,
    '-keypass', senha,
    '-dname', 'CN=MonitorZcnet, O=ZCNet Provedor, C=BR',
  ]);
  fs.writeFileSync(
    SENHAS,
    '# Senha da keystore de release do MonitorZcnet. Fora do git de proposito.\n' +
      '# Guarde junto com monitorzcnet-release.jks: sem este par, um APK novo tem\n' +
      '# assinatura diferente e o Android recusa instalar por cima do instalado.\n' +
      `MONITORZCNET_STORE_FILE=${path.basename(KEYSTORE)}\n` +
      `MONITORZCNET_KEY_ALIAS=${ALIAS}\n` +
      `MONITORZCNET_STORE_PASSWORD=${senha}\n` +
      `MONITORZCNET_KEY_PASSWORD=${senha}\n`,
    'utf8'
  );
  nota(`senha gravada em ${path.basename(SENHAS)} (nao aparece no terminal)`);
}

/** Sobe o versionCode pra o APK novo instalar por cima do anterior. */
function subirVersionCode() {
  const p = path.join(RAIZ, 'app.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  const atual = cfg.expo.android.versionCode || 1;
  cfg.expo.android.versionCode = atual + 1;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  nota(`versionCode ${atual} -> ${atual + 1} (Android recusa instalar por cima de um codigo maior)`);
  return cfg.expo.version;
}

/** Troca a assinatura de debug pela de release no build.gradle gerado. */
function aplicarAssinatura() {
  const p = path.join(ANDROID, 'app', 'build.gradle');
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('signingConfigs.release')) {
    nota('build.gradle ja aponta pra assinatura de release');
    return;
  }

  const bloco = `    signingConfigs {
        debug {`;
  if (!s.includes(bloco)) throw new Error('build.gradle nao tem o bloco signingConfigs esperado');

  // Le as senhas do arquivo de fora do git, na hora do build.
  s = s.replace(
    bloco,
    `    signingConfigs {
        release {
            def props = new Properties()
            file("../../android-signing.properties").withInputStream { props.load(it) }
            storeFile file("../../" + props['MONITORZCNET_STORE_FILE'])
            storePassword props['MONITORZCNET_STORE_PASSWORD']
            keyAlias props['MONITORZCNET_KEY_ALIAS']
            keyPassword props['MONITORZCNET_KEY_PASSWORD']
        }
        debug {`
  );

  const alvo = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;
  if (!s.includes(alvo)) throw new Error('build.gradle nao tem o buildType release esperado');
  s = s.replace(alvo, `        release {
            signingConfig signingConfigs.release`);

  fs.writeFileSync(p, s, 'utf8');
  nota('assinatura de release aplicada no build.gradle');
}

function main() {
  const sdk = acharSdk();
  passo('Ambiente');
  nota(`Android SDK: ${sdk}`);

  passo('Keystore');
  garantirKeystore();

  passo('Versao');
  const versao = subirVersionCode();

  // Antes do prebuild: ele gera android/ a partir do app.json, incluindo o
  // versionCode novo.
  passo('Gerando o projeto nativo (expo prebuild)');
  // O prebuild reescreve os scripts do package.json pra `expo run:android`, que
  // compila um build nativo em vez de abrir o Expo Go. O desenvolvimento aqui e
  // no Expo Go, entao guardamos os scripts e devolvemos depois: gerar APK nao
  // deveria mexer em como se roda o app em dev.
  const pkgPath = path.join(RAIZ, 'package.json');
  const scriptsAntes = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts;

  // Chama o CLI do Expo pelo node, direto: evita depender do npx e do shell.
  rodar('node', [
    path.join(RAIZ, 'node_modules', 'expo', 'bin', 'cli'),
    'prebuild', '--platform', 'android', '--no-install',
  ]);

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (JSON.stringify(pkg.scripts) !== JSON.stringify(scriptsAntes)) {
    pkg.scripts = scriptsAntes;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    nota('scripts do package.json devolvidos (o prebuild tinha trocado)');
  }

  passo('Ajustes no projeto gerado');
  fs.writeFileSync(
    path.join(ANDROID, 'local.properties'),
    `sdk.dir=${sdk.replace(/\\/g, '\\\\')}\n`,
    'utf8'
  );
  nota('local.properties apontando pro SDK');

  const gp = path.join(ANDROID, 'gradle.properties');
  const antes = fs.readFileSync(gp, 'utf8');
  fs.writeFileSync(gp, antes.replace(/^reactNativeArchitectures=.*$/m, `reactNativeArchitectures=${ABIS}`), 'utf8');
  nota(`ABIs: ${ABIS}`);

  aplicarAssinatura();

  passo('Compilando (a primeira vez baixa o Gradle, demora)');
  // Caminho absoluto: com shell no Windows, o nome solto nem sempre e resolvido
  // a partir do cwd.
  const gradlew = path.join(ANDROID, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  rodarScript(gradlew, ['app:assembleRelease'], {
    cwd: ANDROID,
    env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk },
  });

  const gerado = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const destino = path.join(RAIZ, 'build', `MonitorZcnet-${versao}.apk`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(gerado, destino);

  const mb = (fs.statSync(destino).size / 1024 / 1024).toFixed(1);
  passo('Pronto');
  nota(`${destino}  (${mb} MB)`);
  nota('Assinatura nova: desinstale a versao do EAS antes de instalar esta.');
}

main();
