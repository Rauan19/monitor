// Configuração do Metro, o empacotador que serve o app no Expo Go.
//
// Por padrão o Metro abre um worker por núcleo da máquina. Nesta máquina de
// desenvolvimento (9,9 GB de RAM, mas na prática ~1,7 GB livres com o
// navegador e o editor abertos) isso derrubava o `expo start` antes de ele
// conseguir empacotar:
//
//     FATAL ERROR: NewSpace::EnsureCurrentCapacity Allocation failed
//                  - JavaScript heap out of memory
//     [exited with code 134]
//
// Não era teto de heap do Node: a falha é na alocação, com o heap em 80 MB de
// 104 MB. É memória física acabando mesmo. Com dois workers o empacotamento
// termina em 17s e sobra RAM.
//
// Dois é um piso seguro, não um ajuste fino pra esta máquina: numa máquina
// folgada a diferença de tempo é pequena, porque o gargalo do Metro é leitura
// de disco e cache, não paralelismo. Se um dia o build ficar lento numa máquina
// grande, é aqui que se mexe.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.maxWorkers = 2;

module.exports = config;
