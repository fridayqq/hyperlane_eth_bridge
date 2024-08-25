const fs = require('fs');
const { Web3 } = require('web3');
const { bridgeTokens } = require('./bridge');
const rpcUrls = require('./rpcUrls');
const { setTimeout } = require('timers/promises');

// Функция для чтения кошельков из файла
function readWalletsFromFile(filename) {
  const content = fs.readFileSync(filename, 'utf-8');
  const privateKeys = content.split('\n').filter(line => line.trim() !== '');
  const web3 = new Web3();
  return privateKeys.map(privateKey => {
    const account = web3.eth.accounts.privateKeyToAccount(privateKey);
    return { address: account.address, privateKey: privateKey };
  });
}

// Функция для случайного выбора элемента из массива
function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Функция для генерации случайного числа в заданном диапазоне
function getRandomNumber(min, max) {
  return Math.random() * (max - min) + min;
}

// Функция для проверки баланса в сети
async function checkBalance(network, address) {
  const web3 = new Web3(rpcUrls[network]);
  try {
    const balance = await web3.eth.getBalance(address);
    return parseFloat(web3.utils.fromWei(balance, 'ether'));
  } catch (error) {
    console.error(`Ошибка при проверке баланса в сети ${network}:`, error.message);
    return 0;
  }
}

// Функция для проверки балансов во всех сетях
async function checkBalancesInAllNetworks(networks, wallet) {
  const balances = {};
  for (const network of networks) {
    balances[network] = await checkBalance(network, wallet.address);
  }
  return balances;
}

// Функция для генерации маршрута
function generateRoute(startNetwork, networks, numberOfBridges) {
  const route = [startNetwork];
  for (let i = 0; i < numberOfBridges; i++) {
    let nextNetwork;
    do {
      nextNetwork = getRandomElement(networks);
    } while (nextNetwork === route[route.length - 1]);
    route.push(nextNetwork);
  }
  return route;
}

// Функция для выполнения серии бриджей
async function performBridges(route, initialAmount, minDelay, maxDelay, wallet) {
  let currentAmount = initialAmount;

  for (let i = 0; i < route.length - 1; i++) {
    const sourceNetwork = route[i];
    const destinationNetwork = route[i + 1];
    
    console.log(`\nБридж ${i + 1}:`);
    console.log(`Из ${sourceNetwork} в ${destinationNetwork}`);
    console.log(`Сумма: ${currentAmount.toFixed(6)} ETH`);
    console.log(`Используемый кошелек: ${wallet.address}`);
    
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        const result = await bridgeTokens(sourceNetwork, destinationNetwork, currentAmount.toFixed(6), wallet.privateKey);
        if (result && result.transactionHash) {
          console.log(`Транзакция подтверждена. Хэш: ${result.transactionHash}`);
          console.log(`Ссылка на сканер: ${scannerUrls[sourceNetwork]}${result.transactionHash}`);
          break;
        }
      } catch (error) {
        console.error(`Ошибка при выполнении бриджа из ${sourceNetwork} в ${destinationNetwork}:`, error.message);
        if (error.receipt) {
          console.error("Детали транзакции:", JSON.stringify(error.receipt, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
          ));
        }
        if (error.reason) {
          console.error("Причина ошибки:", error.reason);
        }

        retryCount++;
        if (retryCount < maxRetries) {
          const retryDelay = Math.floor(getRandomNumber(30, 60)) * 1000;
          console.log(`Повторная попытка через ${retryDelay / 1000} секунд...`);
          await setTimeout(retryDelay);
        } else {
          console.log("Достигнуто максимальное количество попыток. Прерывание выполнения маршрута.");
          throw new Error("Превышено количество попыток выполнения бриджа");
        }
      }
    }
    
    if (i < route.length - 2) {
      const deduction = getRandomNumber(0.0001, 0.0005);
      currentAmount = Math.max(currentAmount - deduction, 0);
      const delay = Math.floor(getRandomNumber(minDelay, maxDelay));
      console.log(`Ожидание ${delay} секунд перед следующим бриджем...`);
      await setTimeout(delay * 1000);
    }
  }
}

// Основная функция run
async function run() {
  const allowedNetworks = ["base", "linea", "arbitrum", "optimism", "scroll"];
  const minBridges = 2;
  const maxBridges = 4;
  const minDelay = 60; // минимальная задержка в секундах
  const maxDelay = 300; // максимальная задержка в секундах

  const wallets = readWalletsFromFile('wallets.txt');
  if (wallets.length === 0) {
    console.error("Ошибка: файл wallets.txt пуст или не содержит валидных кошельков");
    return;
  }

  // Перемешиваем кошельки и выводим информацию о порядке
  const shuffledWallets = wallets.sort(() => Math.random() - 0.5);
  console.log("Порядок обработки кошельков:");
  shuffledWallets.forEach((wallet, index) => {
    console.log(`${index + 1}. ${wallet.address}`);
  });
  console.log("\n");

  const bridgeStats = {};

  for (const wallet of shuffledWallets) {
    console.log(`\nРабота с кошельком: ${wallet.address}`);
    const balances = await checkBalancesInAllNetworks(allowedNetworks, wallet);
    console.log("Балансы:", balances);

    const maxBalanceNetwork = Object.entries(balances).reduce((a, b) => a[1] > b[1] ? a : b)[0];
    const maxBalance = balances[maxBalanceNetwork];

    if (maxBalance > 0.008) {
      const initialAmount = maxBalance * getRandomNumber(0.7, 0.9);
      const numberOfBridges = Math.floor(getRandomNumber(minBridges, maxBridges + 1));
      const route = generateRoute(maxBalanceNetwork, allowedNetworks, numberOfBridges);

      console.log(`Выбрана сеть: ${maxBalanceNetwork}`);
      console.log(`Начальная сумма: ${initialAmount.toFixed(6)} ETH`);
      console.log("Сгенерированный маршрут:", route);

      try {
        await performBridges(route, initialAmount, minDelay, maxDelay, wallet);
        bridgeStats[wallet.address] = (bridgeStats[wallet.address] || 0) + route.length - 1;

        // Пауза только если бриджи были выполнены успешно
        const pauseDuration = Math.floor(getRandomNumber(300, 600)); // Пауза 5-10 минут
        console.log(`Пауза ${pauseDuration} секунд перед следующим кошельком...`);
        await setTimeout(pauseDuration * 1000);
      } catch (error) {
        console.error("Ошибка при выполнении бриджей:", error.message);
        console.log("Пропуск текущего кошелька.");
        bridgeStats[wallet.address] = (bridgeStats[wallet.address] || 0);
        // Нет паузы, сразу переходим к следующему кошельку
      }
    } else {
      console.log("Недостаточно средств для выполнения бриджей.");
      bridgeStats[wallet.address] = 0;
      // Нет паузы, сразу переходим к следующему кошельку
    }
  }

  console.log("\nВсе кошельки обработаны.");
  console.log("\nСтатистика бриджей:");
  console.log("Адрес кошелька                                    | Количество бриджей");
  console.log("--------------------------------------------------|---------------------");
  for (const [address, count] of Object.entries(bridgeStats)) {
    console.log(`${address.padEnd(50)} | ${count}`);
  }
}

// Объект с URL сканеров для каждой сети
const scannerUrls = {
  base: "https://basescan.org/tx/",
  scroll: "https://scrollscan.com/tx/",
  linea: "https://lineascan.build/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
};

// Запуск скрипта
run().catch(console.error);