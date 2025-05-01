import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs/promises';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import cfonts from 'cfonts';
import { Wallet } from 'ethers';

function centerText(text, color = 'blueBright') {
  const terminalWidth = process.stdout.columns || 80;
  const textLength = text.length;
  const padding = Math.max(0, Math.floor((terminalWidth - textLength) / 2));
  return ' '.repeat(padding) + chalk[color](text);
}

const baseHeaders = {
  'accept': 'application/json, text/plain, */*',
  'content-type': 'application/json',
  'Referer': 'https://app.stobix.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
};

function createAxiosInstance(proxy) {
  const instance = axios.create({
    headers: baseHeaders,
    withCredentials: true,
  });
  if (proxy) {
    instance.defaults.httpsAgent = newAgent(proxy);
  }
  return instance;
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function countdown(ms) {
  const seconds = Math.floor(ms / 1000);
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(chalk.grey(`\rMenunggu ${i} detik... `));
    await delay(1000);
  }
  process.stdout.write('\r' + ' '.repeat(50) + '\r');
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

async function visitInvitePage(axiosInstance, reffcode) {
  const inviteUrl = `https://stobix.com/invite/${reffcode}`;
  const spinnerInvite = ora(' Getting Invite Link...').start();
  try {
    await axiosInstance.get(inviteUrl);
    spinnerInvite.succeed(chalk.greenBright(' Invite Link Connected'));
  } catch (error) {
    spinnerInvite.fail(chalk.redBright(` Error While Connecting : ${error.message}`));
    throw error;
  }
  await delay(1000);
}

async function authenticateWallet(axiosInstance, walletAddress, privateKey) {
  const wallet = new Wallet(privateKey);
  const spinnerAuth = ora(' Login Process...').start();

  try {
    const nonceUrl = 'https://api.stobix.com/v1/auth/nonce';
    const noncePayload = { address: walletAddress };
    const nonceResponse = await axiosInstance.post(nonceUrl, noncePayload);
    const { nonce } = nonceResponse.data;

    const message = `Sign this message to authenticate: ${nonce}`;
    const signature = await wallet.signMessage(message);

    const verifyUrl = 'https://api.stobix.com/v1/auth/web3/verify';
    const verifyPayload = { nonce, signature, chain: 1 };
    const verifyResponse = await axiosInstance.post(verifyUrl, verifyPayload);
    const { token } = verifyResponse.data;

    spinnerAuth.succeed(chalk.greenBright(' Login Succesfully'));
    return token;
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message;
    spinnerAuth.fail(chalk.redBright(`Login Failed: ${errorMessage}`));
    throw error;
  }
}

async function completeTasks(axiosInstance, walletAddress, token) {
  const loyaltyUrl = 'https://api.stobix.com/v1/loyalty';
  const spinnerTasks = ora(' Getting Task List...').start();

  try {
    const loyaltyResponse = await axiosInstance.get(loyaltyUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const tasks = loyaltyResponse.data.tasks;

    spinnerTasks.succeed(chalk.greenBright(' Task List Received '));

    for (const task of tasks) {
      const { id, claimedAt } = task;

      if (id === 'create_futures' || id === 'create_dual') {
        continue;
      }

      if (claimedAt !== null) {
        console.log(chalk.blue(` Task ${id} Already Done`));
        continue;
      }

      const spinnerClaim = ora(` Completing Task ${id}...`).start();
      try {
        const claimUrl = 'https://api.stobix.com/v1/loyalty/tasks/claim';
        const claimPayload = { taskId: id };
        const claimResponse = await axiosInstance.post(claimUrl, claimPayload, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const { points } = claimResponse.data;
        spinnerClaim.succeed(chalk.greenBright(` Task ${id} Done `));
      } catch (error) {
        const errorMessage = error.response?.data?.message || error.message;
        spinnerClaim.fail(chalk.redBright(` Failed Completing Task ${id}: ${errorMessage}`));
      }
    }
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    spinnerTasks.fail(chalk.redBright(` Error Getting Task List: ${errorMessage}`));
  }
}

async function startMining(axiosInstance, token) {
  const loyaltyUrl = 'https://api.stobix.com/v1/loyalty';
  const spinnerCheck = ora(' Checking Mining Status...').start();

  try {
    const loyaltyResponse = await axiosInstance.get(loyaltyUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { miningStartedAt, miningClaimAt } = loyaltyResponse.data.user;

    if (miningStartedAt && miningClaimAt && new Date(miningClaimAt) > new Date()) {
      spinnerCheck.succeed(chalk.greenBright(` Mining Already Started`));
      return;
    }

    spinnerCheck.succeed(chalk.greenBright(' Mining Not Started , Ready To Start Mining...'));
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    spinnerCheck.fail(chalk.redBright(` Error Checking Mining Status: ${errorMessage}`));
  }

  const mineUrl = 'https://api.stobix.com/v1/loyalty/points/mine';
  const spinnerMine = ora(' Mining Starting...').start();

  try {
    const mineResponse = await axiosInstance.post(mineUrl, {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { amount, startedAt, claimAt } = mineResponse.data;
    spinnerMine.succeed(chalk.greenBright(` Mining Started Successfully: ${amount} Point`));
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message;
    spinnerMine.fail(chalk.redBright(` Failed To Start Mining: ${errorMessage}`));
  }
}

async function getUserPoints(axiosInstance, token) {
  const loyaltyUrl = 'https://api.stobix.com/v1/loyalty';
  const spinnerPoints = ora(' Getting Total Points...').start();

  try {
    const loyaltyResponse = await axiosInstance.get(loyaltyUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const points = loyaltyResponse.data.user.points;
    spinnerPoints.succeed(chalk.greenBright(` Total points: ${points}`));
    return points;
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    spinnerPoints.fail(chalk.redBright(` Error Getting Total Points: ${errorMessage}`));
    return null;
  }
}

async function main() {
    cfonts.say('SOUIY', {
      font: 'block',
      align: 'center',
      colors: ['cyan', 'black'],
    });
    console.log(centerText("=== FOLLOW TIKTOK 🚀 : SOUIY (@souiy1) ==="));
    console.log(centerText("✪ STOBIX AUTO REFF + RUN NODE ✪ \n"));
  
    console.log(chalk.yellow('============ Auto Registration Bot ===========\n'));
  
    let { useProxy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useProxy',
        message: 'Do You Want To Use Proxy ?',
        default: false,
      }
    ]);
  
    let proxyList = [];
    let proxyMode = null;
    if (useProxy) {
      const proxyAnswer = await inquirer.prompt([
        {
          type: 'list',
          name: 'proxyType',
          message: 'Pilih jenis proxy:',
          choices: ['Rotating', 'Static'],
        }
      ]);
      proxyMode = proxyAnswer.proxyType;
      proxyList = await readProxies();
      if (proxyList.length > 0) {
        console.log(chalk.blueBright(`Terdapat ${proxyList.length} proxy.\n`));
        if (proxyMode === 'Rotating') {
          console.log(chalk.redBright('PERINGATAN: Anda menggunakan proxy rotating. Untuk memastikan referral terdeteksi, pastikan proxy Anda mendukung sticky sessions (IP tetap untuk satu sesi).'));
          console.log(chalk.yellow('Cara mengatur sticky sessions:'));
          console.log(chalk.yellow('- Login ke dashboard penyedia proxy Anda'));
          console.log(chalk.yellow('- Cari pengaturan "Sticky Sessions" atau "Session Persistence".'));
          console.log(chalk.yellow('- Aktifkan sticky sessions dan atur durasi (misalnya, 1 menit) agar IP tetap sama untuk semua request dalam satu akun.'));
          console.log(chalk.yellow('- Jika tidak tersedia, ganti proxy static atau jalankan tanpa proxy.\n'));
          const { confirmSticky } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirmSticky',
              message: 'Apakah proxy Anda sudah diatur dengan sticky sessions?',
              default: false,
            }
          ]);
          if (!confirmSticky) {
            console.log(chalk.yellow('Disarankan untuk mengatur sticky sessions atau menjalankan tanpa proxy. Lanjutkan dengan risiko referral tidak masuk.\n'));
          }
        }
      } else {
        console.log(chalk.yellow('File proxy.txt tidak ditemukan atau kosong. Lanjut tanpa proxy.\n'));
        useProxy = false; 
      }
    }

  let count;
  while (true) {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'count',
        message: 'Masukkan jumlah akun yang di buat: ',
        validate: (value) => {
          const parsed = parseInt(value, 10);
          if (isNaN(parsed) || parsed <= 0) {
            return 'Harap masukkan angka yang valid lebih dari 0!';
          }
          return true;
        }
      }
    ]);
    count = parseInt(answer.count, 10);
    if (count > 0) break;
  }

  const { ref } = await inquirer.prompt([
    {
      type: 'input',
      name: 'ref',
      message: 'Masukkan kode referral anda: ',
    }
  ]);

  console.log(chalk.yellow('\n==================================='));
  console.log(chalk.yellowBright(`Membuat ${count} akun ..`));
  console.log(chalk.yellowBright('Note: Jangan Bar Barbar Bang 🗿'));
  console.log(chalk.yellowBright('Saran: Kalau Mau BarBar, gunakan Proxy..'));
  console.log(chalk.yellow('=====================================\n'));

  const fileName = 'accounts.json';
  let accounts = [];
  try {
    const data = await fs.readFile(fileName, 'utf-8');
    accounts = JSON.parse(data);
  } catch (err) {
    accounts = [];
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < count; i++) {
    console.log(chalk.cyanBright(`\n================================ ACCOUNT ${i + 1}/${count} ================================`));

    let proxy = null;
    if (useProxy && proxyList.length > 0) {
      proxy = proxyList[i % proxyList.length];
      console.log(chalk.white(`Menggunakan proxy: ${proxy}`));
    }

    const axiosInstance = createAxiosInstance(proxy);
    const wallet = Wallet.createRandom();
    const walletAddress = wallet.address;
    const privateKey = wallet.privateKey.startsWith('0x') ? wallet.privateKey.slice(2) : wallet.privateKey;

    console.log(chalk.greenBright(`✔️ Wallet Ethereum berhasil dibuat: ${walletAddress}`));

    try {
      await visitInvitePage(axiosInstance, ref);
      const token = await authenticateWallet(axiosInstance, walletAddress, wallet.privateKey);
      await completeTasks(axiosInstance, walletAddress, token);
      await startMining(axiosInstance, token);
      await getUserPoints(axiosInstance, token);

      accounts.push({
        walletAddress: walletAddress,
        privateKey: privateKey,
      });
      await fs.writeFile(fileName, JSON.stringify(accounts, null, 2));
      console.log(chalk.greenBright('✔️ Data akun berhasil disimpan ke accounts.json'));
      successCount++;
    } catch (error) {
      console.log(chalk.red(`✖ Gagal untuk ${walletAddress}: ${error.message}`));
      failCount++;
    }

    console.log(chalk.yellow(`\nProgress: ${i + 1}/${count} akun telah diregistrasi. (Berhasil: ${successCount}, Gagal: ${failCount})`));
    console.log(chalk.cyanBright('====================================================================\n'));

    if (i < count - 1) {
      const randomDelay = Math.floor(Math.random() * (60000 - 30000 + 1)) + 30000;
      await countdown(randomDelay);
    }
  }

  console.log(chalk.blueBright('\nRegistrasi selesai.'));
}

main();
