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

// Só 64 bits ARM.
//
// O template vem com quatro ABIs: x86 e x86_64 servem pra emulador, e
// armeabi-v7a pra celular de 32 bits. Cada ABI e uma compilacao C++ completa de
// todos os modulos nativos.
//
// O armeabi-v7a saiu porque era ele que derrubava o build nesta maquina: o
// clang++ morria por falta de memoria compilando o react-native-svg pra
// armv7-none-linux-android24. Sai tambem metade do tamanho do APK.
//
// O custo: celular que SO tem 32 bits nao instala. Na pratica nao existe no
// parque atual, aparelho e arm64 desde meados de 2015 e o Google Play exige 64
// bits desde 2019. Se um dia precisar, volte 'armeabi-v7a' aqui, mas numa
// maquina com mais RAM.
const ABIS = 'arm64-v8a';

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

/** Quantos arquivos com essa extensao existem abaixo de um diretorio. */
function contarArquivos(dir, extensao) {
  let total = 0;
  const visitar = (atual) => {
    let entradas;
    try {
      entradas = fs.readdirSync(atual, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      if (e.isDirectory()) visitar(path.join(atual, e.name));
      else if (e.name.endsWith(extensao)) total++;
    }
  };
  visitar(dir);
  return total;
}

/**
 * Apaga o codegen gerado dentro de node_modules.
 *
 * O passo generateCodegenArtifactsFromSchema escreve o arquivo e depois faz
 * rename pro lugar final. No Windows, rename sobre arquivo que ja existe falha
 * com EPERM quando alguem esta com ele aberto, e antivirus varrendo arquivo
 * recem-escrito faz exatamente isso. Sem o destino antigo no caminho, o rename
 * nao tem com o que colidir. Isso regenera em segundos.
 */
function limparCodegen() {
  const mods = path.join(RAIZ, 'node_modules');
  let apagados = 0;
  const visitar = (dir, profundidade) => {
    if (profundidade > 2) return;
    let entradas;
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      if (!e.isDirectory()) continue;
      const alvo = path.join(dir, e.name, 'android', 'build', 'generated', 'source', 'codegen');
      if (fs.existsSync(alvo)) {
        try {
          fs.rmSync(alvo, { recursive: true, force: true });
          apagados++;
        } catch {
          // travado agora: o build tenta de novo por conta
        }
      }
      if (e.name.startsWith('@')) visitar(path.join(dir, e.name), profundidade + 1);
    }
  };
  visitar(mods, 1);
  if (apagados) nota(`codegen antigo apagado em ${apagados} modulo(s)`);
}

/** Grava o versionCode direto no projeto nativo, sem precisar do prebuild. */
function gravarVersionCodeNativo(versionCode) {
  const p = path.join(ANDROID, 'app', 'build.gradle');
  const s = fs.readFileSync(p, 'utf8');
  const re = /^(\s*versionCode\s+)\d+$/m;
  if (!re.test(s)) throw new Error('build.gradle nao tem a linha de versionCode');
  fs.writeFileSync(p, s.replace(re, `$1${versionCode}`), 'utf8');
  nota(`versionCode ${versionCode} gravado no projeto nativo`);
}

/** Sobe o versionCode pra o APK novo instalar por cima do anterior. */
function subirVersionCode() {
  const p = path.join(RAIZ, 'app.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  const atual = cfg.expo.android.versionCode || 1;
  cfg.expo.android.versionCode = atual + 1;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  nota(`versionCode ${atual} -> ${atual + 1} (Android recusa instalar por cima de um codigo maior)`);
  return { versao: cfg.expo.version, versionCode: atual + 1 };
}

/**
 * Limita quantos clang++ rodam ao mesmo tempo na compilacao nativa.
 *
 * Esta era a causa real dos builds morrendo nesta maquina:
 *
 *   LLVM ERROR: out of memory / Allocation failed
 *
 * O ninja, que faz a compilacao C++ por dentro do Gradle, abre um job por
 * nucleo. Com 12 nucleos sao 12 a 14 clang++ simultaneos, cada um querendo
 * centenas de MB num arquivo C++20 cheio de template (rnscreens.cpp,
 * RNSVGLayoutableShadowNode.cpp). Em ~10 GB de RAM isso nao cabe, e quem morre
 * e o clang, nao o Gradle: por isso `org.gradle.workers.max` nao resolvia, ele
 * so limita as tarefas do Gradle e nao alcanca o ninja.
 *
 * Job pool do CMake e o jeito de falar com o ninja: `compile=N` limita os
 * jobs de compilacao, e `link=1` o de ligacao, que e o passo que pede mais
 * memoria de uma vez. O build fica mais lento e passa a caber.
 */
function limitarJobsNativos(jobs) {
  const p = path.join(ANDROID, 'app', 'build.gradle');
  let s = fs.readFileSync(p, 'utf8');

  // Reescreve SEMPRE, nunca pula porque "ja existe".
  //
  // O numero de jobs sai da memoria livre no momento do build, entao envelhece:
  // android/ e reaproveitada entre builds, e um valor escrito num dia de maquina
  // folgada (compile=2, compile=4) continuava valendo num dia apertado. O
  // resultado era o build morrer em LLVM ERROR: out of memory justamente quando
  // a protecao existia pra evitar isso, e a mensagem "ja limita os jobs nativos"
  // dava a impressao de que estava tudo certo.
  const atual = s.match(/-DCMAKE_JOB_POOLS=compile=(\d+)/);
  if (atual) {
    if (Number(atual[1]) === jobs) {
      nota(`jobs de compilacao nativa: ${jobs} (ja estava assim)`);
      return;
    }
    s = s.replace(
      /-DCMAKE_JOB_POOLS=compile=\d+;link=1/,
      `-DCMAKE_JOB_POOLS=compile=${jobs};link=1`
    );
    fs.writeFileSync(p, s, 'utf8');
    nota(`jobs de compilacao nativa: ${atual[1]} -> ${jobs} (memoria livre mudou)`);
    return;
  }

  const alvo = `    defaultConfig {
        applicationId '`;
  if (!s.includes(alvo)) throw new Error('build.gradle nao tem o defaultConfig esperado');

  // defaultConfig e aditivo: estes argumentos se somam aos que o plugin do
  // React Native ja configura, nao substituem.
  s = s.replace(
    alvo,
    `    defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_JOB_POOLS=compile=${jobs};link=1",
                          "-DCMAKE_JOB_POOL_COMPILE=compile",
                          "-DCMAKE_JOB_POOL_LINK=link"
            }
        }
        applicationId '`
  );
  fs.writeFileSync(p, s, 'utf8');
  nota(`jobs de compilacao nativa limitados a ${jobs}`);
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

/**
 * Impede dois builds ao mesmo tempo.
 *
 * `expo prebuild` APAGA e recria a pasta android/. Se um segundo build comeca
 * enquanto o Gradle do primeiro esta lendo dali, o prebuild falha com EBUSY e o
 * que sobra e um projeto nativo pela metade, com o build antigo seguindo em cima
 * de arquivos que mudaram. O erro que aparece depois nao tem relacao obvia com a
 * causa, e isso custa tempo pra entender.
 *
 * O arquivo guarda o pid: se o processo que o criou nao existe mais (build
 * morreu, maquina reiniciou), a trava e considerada orfa e liberada.
 */
function travar() {
  const lock = path.join(RAIZ, 'android', '.build-apk.lock');
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, 'utf8').trim());
    let vivo = false;
    try {
      process.kill(pid, 0); // nao mata: so pergunta se existe
      vivo = true;
    } catch {
      vivo = false;
    }
    if (vivo) {
      console.error(
        `\nJa tem um build rodando nesta pasta (pid ${pid}).\n\n` +
          'Dois builds juntos se atropelam: o prebuild de um apaga a pasta android/\n' +
          'que o Gradle do outro esta lendo. Espere o primeiro terminar.\n\n' +
          `Se tiver certeza que nao existe mais, apague:\n  ${lock}`
      );
      process.exit(1);
    }
    nota(`trava orfa do pid ${pid} liberada`);
  }
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, String(process.pid), 'utf8');
  const soltar = () => {
    try {
      fs.unlinkSync(lock);
    } catch {
      // ja foi
    }
  };
  process.on('exit', soltar);
  process.on('SIGINT', () => {
    soltar();
    process.exit(130);
  });
}

function main() {
  const sdk = acharSdk();
  passo('Ambiente');
  nota(`Android SDK: ${sdk}`);
  travar();

  passo('Keystore');
  garantirKeystore();

  passo('Versao');
  const { versao, versionCode } = subirVersionCode();

  // Prebuild SO quando precisa.
  //
  // `expo prebuild` apaga e recria android/ inteira, e junto vai
  // android/app/build e android/app/.cxx: toda a compilacao C++ ja feita. Numa
  // maquina onde o build nativo e a parte demorada e a que mais arrisca estourar
  // a memoria, rodar prebuild em toda tentativa significa refazer do zero a cada
  // vez, e foi isso que fez varias tentativas baterem na mesma parede.
  //
  // Entao: se android/ ja existe, o projeto nativo e reaproveitado e o
  // versionCode e gravado direto nele. Passe --prebuild pra forcar a
  // regeneracao, que e o que se faz depois de mexer no app.json, nos plugins ou
  // nas dependencias nativas.
  const forcarPrebuild = process.argv.includes('--prebuild');
  const temNativo = fs.existsSync(path.join(ANDROID, 'app', 'build.gradle'));

  if (forcarPrebuild || !temNativo) {
    passo('Gerando o projeto nativo (expo prebuild)');
    if (temNativo) nota('--prebuild: a compilacao nativa anterior sera descartada');

    // O prebuild reescreve os scripts do package.json pra `expo run:android`,
    // que compila um build nativo em vez de abrir o Expo Go. O desenvolvimento
    // aqui e no Expo Go, entao guardamos os scripts e devolvemos depois: gerar
    // APK nao deveria mexer em como se roda o app em dev.
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
  } else {
    passo('Projeto nativo');
    const sos = contarArquivos(path.join(ANDROID, 'app', 'build'), '.so');
    nota(`reaproveitando android/ (${sos} bibliotecas nativas ja compiladas)`);
    nota('use --prebuild depois de mexer no app.json, plugins ou libs nativas');
    gravarVersionCodeNativo(versionCode);
  }

  passo('Ajustes no projeto gerado');
  limparCodegen();
  fs.writeFileSync(
    path.join(ANDROID, 'local.properties'),
    `sdk.dir=${sdk.replace(/\\/g, '\\\\')}\n`,
    'utf8'
  );
  nota('local.properties apontando pro SDK');

  const gp = path.join(ANDROID, 'gradle.properties');
  let props = fs.readFileSync(gp, 'utf8');
  props = props.replace(/^reactNativeArchitectures=.*$/m, `reactNativeArchitectures=${ABIS}`);
  nota(`ABIs: ${ABIS}`);

  // Memoria. Esta maquina tem ~10 GB, e o padrao do template foi feito pra
  // maquina de build folgada: o build morreu com "insufficient memory for the
  // Java Runtime Environment", num malloc nativo dentro do R8 (a fase de dex, a
  // mais faminta). O que estourava:
  //
  // - org.gradle.parallel=true sem limite de workers: com 12 nucleos o Gradle
  //   abre worker por nucleo, cada um alocando nativo por fora do heap.
  // - o compilador Kotlin roda numa SEGUNDA JVM por padrao, com heap propria
  //   somada a do daemon do Gradle.
  //
  // Entao: uma JVM so, poucos workers, e heap um pouco maior porque agora o
  // Kotlin divide ela. Serial GC porque o G1 mantem estruturas e threads por
  // nucleo, e aqui o gargalo e memoria, nao tempo de GC.
  // Sobre o -Xmx: subir nao ajuda aqui, atrapalha. Com 3 GB a JVM morreu num
  // malloc NATIVO e o proprio crash dizia "Decrease Java heap size": o heap
  // reservado sufoca a memoria nativa da mesma JVM, que e de onde sai o
  // trabalho do R8 e do compilador. 2 GB e o valor do template, e e o que
  // completou build nesta maquina.
  const MEMORIA = {
    'org.gradle.jvmargs': '-Xmx2048m -XX:MaxMetaspaceSize=512m -XX:+UseSerialGC -Dfile.encoding=UTF-8',
    'org.gradle.parallel': 'false',
    'org.gradle.workers.max': '2',
    'kotlin.compiler.execution.strategy': 'in-process',
  };
  for (const [chave, valor] of Object.entries(MEMORIA)) {
    const linha = `${chave}=${valor}`;
    const re = new RegExp(`^${chave.replace(/\./g, '\\.')}=.*$`, 'm');
    props = re.test(props) ? props.replace(re, linha) : `${props.trimEnd()}\n${linha}\n`;
  }
  fs.writeFileSync(gp, props, 'utf8');
  nota(`memoria: 1 JVM, heap ${MEMORIA['org.gradle.jvmargs'].match(/-Xmx(\S+)/)[1]}, ${MEMORIA['org.gradle.workers.max']} workers`);

  aplicarAssinatura();

  // Um clang++ nestes arquivos chega a pedir ~1,5 GB. O numero sai da memoria
  // livre, nao do numero de nucleos, porque aqui o limite e memoria.
  const jobs = Math.max(1, Math.min(4, Math.floor(os.freemem() / 1024 ** 3 / 1.5)));
  limitarJobsNativos(jobs);

  // Caminho absoluto: com shell no Windows, o nome solto nem sempre e resolvido
  // a partir do cwd.
  const gradlew = path.join(ANDROID, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const ambiente = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };

  // Derruba daemon antigo antes de compilar. Dois motivos: ele segue residente
  // entre builds segurando GBs, e um daemon iniciado com os jvmargs de antes
  // nao pega os valores novos (o Gradio sobe outro e o velho fica ocupando
  // memoria do mesmo jeito). O cache de compilacao fica em ~/.gradle e nao se
  // perde nisso, so o tempo de subir a JVM.
  passo('Liberando memoria');
  try {
    rodarScript(gradlew, ['--stop'], { cwd: ANDROID, env: ambiente, stdio: 'ignore' });
    nota('daemons antigos do Gradle encerrados');
  } catch {
    nota('nenhum daemon pra encerrar');
  }

  const livreGb = os.freemem() / 1024 ** 3;
  nota(`memoria livre agora: ${livreGb.toFixed(1)} GB`);
  if (livreGb < 3) {
    nota('ATENCAO: abaixo de 3 GB o build pode morrer. Feche navegador e o que');
    nota('estiver pesado, ou rode de novo depois.');
  }

  passo('Compilando (a primeira vez baixa o Gradle, demora)');
  rodarScript(gradlew, ['app:assembleRelease'], { cwd: ANDROID, env: ambiente });

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
