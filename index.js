import axios from 'axios';
import cfonts from 'cfonts';
import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';
import { Wallet } from 'ethers';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import fs from 'fs/promises';

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function centerText(text, color = 'greenBright') {
  const terminalWidth = process.stdout.columns || 80;
  const textLength = text.length;
  const padding = Math.max(0, Math.floor((terminalWidth - textLength) / 2));
  return ' '.repeat(padding) + chalk[color](text);
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/102.0'
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getHeaders(token = null) {
  const headers = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': 'https://app.stobix.com',
    'Referer': 'https://app.stobix.com/'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function getAxiosConfig(proxy, token = null) {
  const config = {
    headers: getHeaders(token),
    timeout: 60000
  };
  if (proxy) {
    config.httpsAgent = newAgent(proxy);
  }
  return config;
}

function newAgent(proxy) {
  if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
    return new SocksProxyAgent(proxy);
  } else {
    console.log(chalk.red(`Unsupported proxy type: ${proxy}`));
    return null;
  }
}

async function requestWithRetry(method, url, payload = null, config = null, retries = 3, backoff = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      let response;
      if (method === 'get') {
        response = await axios.get(url, config);
      } else if (method === 'post') {
        response = await axios.post(url, payload, config);
      } else {
        throw new Error(`Unsupported method: ${method}`);
      }
      return response;
    } catch (error) {
      let errorMessage = error.message;
      if (error.response) {
        const rawData = error.response.data;
        if (typeof rawData === 'string' || Buffer.isBuffer(rawData)) {
          errorMessage = `Invalid response: ${rawData.toString().substring(0, 200)}`;
        } else {
          errorMessage = error.response.data?.message || error.response.data?.error || error.message;
        }
      }
      if (i < retries - 1) {
        console.log(chalk.yellow(`Retry ${i + 1}/${retries} for ${url}: ${errorMessage}`));
        await delay(backoff / 1000);
        backoff *= 1.5;
        continue;
      } else {
        console.error(chalk.red(`Request failed for ${url}: ${errorMessage}`));
        if (error.response) {
          console.error(chalk.red(`Response status: ${error.response.status}`));
          console.error(chalk.red(`Response headers: ${JSON.stringify(error.response.headers, null, 2)}`));
          console.error(chalk.red(`Response data: ${typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data, null, 2)}`));
        }
        throw new Error(`Request failed for ${url}: ${errorMessage}`);
      }
    }
  }
}

async function readAccounts() {
  try {
    const data = await fs.readFile('accounts.json', 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(chalk.red(`Error reading accounts.json: ${error.message}`));
    return [];
  }
}

async function readProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf-8');
    return data
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  } catch (error) {
    console.error(chalk.red(`Error reading proxy.txt: ${error.message}`));
    return [];
  }
}

async function getPublicIP(proxy) {
  try {
    const response = await requestWithRetry('get', 'https://api.ipify.org?format=json', null, getAxiosConfig(proxy));
    return response.data?.ip || 'IP tidak ditemukan';
  } catch (error) {
    return 'Error mengambil IP';
  }
}

async function authenticateWallet(walletAddress, privateKey, proxy) {
  const wallet = new Wallet(privateKey);
  const spinnerAuth = ora({ text: ' Process Login...', spinner: 'dots2', color: 'cyan' }).start();

  try {
    const nonceUrl = 'https://api.stobix.com/v1/auth/nonce';
    const noncePayload = { address: walletAddress };
    const nonceResponse = await requestWithRetry('post', nonceUrl, noncePayload, getAxiosConfig(proxy));
    const { nonce, message } = nonceResponse.data;

    spinnerAuth.text = ' Process Sign Wallet...';
    await delay(0.5);

    const signature = await wallet.signMessage(message);
    spinnerAuth.text = ' Sign Success...';
    await delay(0.5);

    const verifyUrl = 'https://api.stobix.com/v1/auth/web3/verify';
    const verifyPayload = { nonce, signature, chain: 8453 };
    const verifyResponse = await requestWithRetry('post', verifyUrl, verifyPayload, getAxiosConfig(proxy));
    const { token } = verifyResponse.data;

    spinnerAuth.succeed(chalk.greenBright(' Login Successfully'));
    return token;
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message;
    spinnerAuth.fail(chalk.redBright(` Login Failed: ${errorMessage}`));
    throw error;
  }
}

async function completeTasks(walletAddress, proxy, token) {
  const loyaltyUrl = 'https://api.stobix.com/v1/loyalty';
  const spinnerTasks = ora({ text: ' Fetching Task List...', spinner: 'dots2', color: 'cyan' }).start();

  try {
    const loyaltyResponse = await requestWithRetry('get', loyaltyUrl, null, getAxiosConfig(proxy, token));
    const tasks = loyaltyResponse.data.tasks;

    spinnerTasks.succeed(chalk.greenBright(' Task List Received'));

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const { id, claimedAt } = task;

      // 修改后的过滤条件
      if (id === 'create_dual' || 
          id === 'create_futures_btc' || 
          id === 'create_futures_eth' || 
          id === 'create_futures_sol' || 
          id === 'create_dual_100' ||
          id === 'publish_video' ||
          id === 'create_futures') {
        continue;
      }

      if (claimedAt !== null) {
        console.log(chalk.bold.greenBright(`  🎯 Task ${id} Already Done`));
        continue;
      }

      const spinnerClaim = ora({ text: `  Completing Task ${id}...`, spinner: 'dots2', color: 'cyan' }).start();
      try {
        const claimUrl = 'https://api.stobix.com/v1/loyalty/tasks/claim';
        const claimPayload = { taskId: id };
        const claimResponse = await requestWithRetry('post', claimUrl, claimPayload, getAxiosConfig(proxy, token));
        const { points } = claimResponse.data;
        spinnerClaim.succeed(chalk.greenBright(` Completing Task ${id} Successfully`));
      } catch (error) {
        const errorMessage = error.response?.data?.message || error.message;
        spinnerClaim.fail(chalk.redBright(` Failed Completing Task ${id}: ${errorMessage}`));
      }
    }
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    spinnerTasks.fail(chalk.redBright(` Failed Receiving Task List: ${errorMessage}`));
  }
}

async function startMining(proxy, token) {
  const loyaltyUrl = 'https://api.stobix.com/v1/loyalty';
  const spinnerCheck = ora({ text: ' Checking Mining Status...', spinner: 'dots2', color: 'cyan' }).start();

  try {
    const loyaltyResponse = await requestWithRetry('get', loyaltyUrl, null, getAxiosConfig(proxy, token));
    const { miningStartedAt, miningClaimAt } = loyaltyResponse.data.user;

    if (miningStartedAt && miningClaimAt && new Date(miningClaimAt) > new Date()) {
      spinnerCheck.succeed(chalk.greenBright(` Mining Already Started`));
      return;
    }

    spinnerCheck.succeed(chalk.yellowBright(' Mining Not Started , Ready To Start Mining'));
  } catch (error) {
    spinnerCheck.fail(chalk.redBright(` Error Checked Mining Status: ${error.message}`));
  }

  const mineUrl = 'https://api.stobix.com/v1/loyalty/points/mine';
  const spinnerMine = ora({ text: ' Started Mining...', spinner: 'dots2', color: 'cyan' }).start();

  try {
    const mineResponse = await requestWithRetry('post', mineUrl, {}, getAxiosConfig(proxy, token));
    const { amount, startedAt, claimAt } = mineResponse.data;
    spinnerMine.succeed(chalk.greenBright(` Mining Started Successfully: ${amount} Point`));
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message;
    spinnerMine.fail(chalk.redBright(` Failed To Start Mining: ${errorMessage}`));
    throw error;
  }
}

async function getUserPoints(proxy, token) {
  const loyaltyUrl = 'https://api.stobix.com/v1/loyalty';
  const spinnerPoints = ora({ text: ' Getting Points...', spinner: 'dots2', color: 'cyan' }).start();

  try {
    const loyaltyResponse = await requestWithRetry('get', loyaltyUrl, null, getAxiosConfig(proxy, token));
    const points = loyaltyResponse.data.user.points;
    spinnerPoints.succeed(chalk.greenBright(` Total Points: ${points}`));
    return points;
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    spinnerPoints.fail(chalk.redBright(` Error Getting Points: ${errorMessage}`));
    return null;
  }
}

async function processAccount(account, index, total, proxy) {
  const { walletAddress, privateKey } = account;
  console.log(`\n`);
  console.log(chalk.bold.cyanBright('='.repeat(80)));
  console.log(chalk.bold.whiteBright(`Akun: ${index + 1}/${total}`));
  console.log(chalk.bold.whiteBright(`Wallet: ${walletAddress}`));
  const usedIP = await getPublicIP(proxy);
  console.log(chalk.bold.whiteBright(`Using IP: ${usedIP}`));
  console.log(chalk.bold.cyanBright('='.repeat(80)));

  try {
    const wallet = new Wallet(privateKey);
    if (wallet.address.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error('Private key does not match wallet address');
    }
  } catch (error) {
    console.error(chalk.red(`Invalid wallet: ${error.message}`));
    return;
  }

  let token;
  try {
    token = await authenticateWallet(walletAddress, privateKey, proxy);
  } catch (error) {
    console.error(chalk.red(`Error autentikasi: ${error.message}`));
    return;
  }

  await completeTasks(walletAddress, proxy, token);

  try {
    await startMining(proxy, token);
  } catch (error) {
    console.error(chalk.red(` Mining Error , Skipping Mining Procces: ${error.message}`));
  }

  await getUserPoints(proxy, token);
}

async function main() {
  cfonts.say('SOUIY', {
    font: 'block',
    align: 'center',
    colors: ['cyan', 'magenta'],
    background: 'transparent',
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: '0'
  });
  console.log(centerText("=== FOLLOW TIKTOK 🚀 : SOUIY (@souiy1) ===\n"));
  console.log(centerText("✪ STOBIX AUTO RUN NODE ✪ \n"));

  const useProxyAns = await askQuestion('Ingin menggunakan proxy? (y/n): ');
  let proxies = [];
  let useProxy = false;
  if (useProxyAns.trim().toLowerCase() === 'y') {
    useProxy = true;
    proxies = await readProxies();
    if (proxies.length === 0) {
      console.log(chalk.yellow('Tidak ada proxy di proxy.txt. Lanjut tanpa proxy.'));
      useProxy = false;
    }
  }

  const accounts = await readAccounts();
  if (accounts.length === 0) {
    console.log(chalk.red('Tidak ada akun di accounts.json.'));
    return;
  }

  async function runCycle() {
    for (let i = 0; i < accounts.length; i++) {
      const proxy = useProxy ? proxies[i % proxies.length] : null;
      try {
        await processAccount(accounts[i], i, accounts.length, proxy);
      } catch (error) {
        console.error(chalk.red(`Error pada akun ${i + 1}: ${error.message}`));
      }
    }
    console.log(chalk.magentaBright('All Account Already Proccessed , Waiting 8 Hours Before Next Mining'));
    await delay(28800);
    runCycle();
  }

  runCycle();
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

main();