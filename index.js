import axios from 'axios';
import { ethers } from 'ethers';
import fs from 'fs';
import log from './config/logger.js';
import banner from './config/banner.js';
import contract from './config/contract.js';

function readWallets() {
   if (fs.existsSync('wallets.json')) {
      const data = fs.readFileSync('wallets.json');
      return JSON.parse(data);
   } else {
      log.error('No wallets found in wallets.json. Exiting');
      process.exit(1);
   }
}

const API = 'https://lightmining-api.taker.xyz/';
const baseURL = axios.create({
   baseURL: API,
});

const get = async (url, token) => {
   return await baseURL.get(url, {
      headers: {
         Authorization: `Bearer ${token}`,
      },
   });
};

const post = async (url, data, config = {}) => {
   return await baseURL.post(url, data, config);
};

const sleep = (s) => {
   return new Promise((resolve) => setTimeout(resolve, s * 1000));
};

async function signMessage(message, privateKey) {
   const wallet = new ethers.Wallet(privateKey);
   try {
      const signature = await wallet.signMessage(message);
      return signature;
   } catch (error) {
      log.error('Error signing message:', error);
      return null;
   }
}

//get nonce for login
const getNonce = async (walletAddress, retries = 3) => {
   try {
      const res = await post(`wallet/generateNonce`, { walletAddress });
      return res.data;
   } catch (error) {
      if (retries > 0) {
         log.error('Failed to get nonce:', error.message);
         log.warn(`Retrying... (${retries - 1} attempts left)`);
         await sleep(3);
         return await getNonce(walletAddress, retries - 1);
      } else {
         log.error('Failed to get nonce after retries:', error.message);
         return null;
      }
   }
};

const loginAcc = async (address, message, signature, retries = 3) => {
   try {
      const res = await post(`wallet/login`, {
         address,
         //  invitationCode: '',
         message,
         signature,
      });
      return res.data.data;
   } catch (error) {
      if (retries > 0) {
         log.error('Failed to login:', error.message);
         log.warn(`Retrying... (${retries - 1} attempts left)`);
         await sleep(3);
         return await loginAcc(address, message, signature, retries - 1);
      } else {
         log.error('Failed to login after retries:', error.message);
         return null;
      }
   }
};
//user info
const getUser = async (token, retries = 3) => {
   try {
      const response = await get('user', token);
      return response.data;
   } catch (error) {
      if (retries > 0) {
         log.error('Failed to get user data:', error.message);
         log.warn(`Retrying... (${retries - 1} attempts left)`);
         await sleep(3);
         return await getUser(token, retries - 1);
      } else {
         log.error('Failed to get user data after retries:', error.message);
         return null;
      }
   }
};

const startMine = async (token, retries = 3) => {
   try {
      const res = await post(`assignment/startMining`, {}, { headers: { Authorization: `Bearer ${token}` } });
      return res.data;
   } catch (error) {
      if (retries > 0) {
         log.error('Failed to start mining:', error.message);
         log.warn(`Retrying... (${retries - 1} attempts left)`);
         await sleep(3);
         return await startMine(token, retries - 1);
      } else {
         log.error('Failed to start mining after retries:', error.message);
         return null;
      }
   }
};

const getMinerStatus = async (token, retries = 3) => {
   try {
      const response = await get('assignment/totalMiningTime', token);
      return response.data;
   } catch (error) {
      if (retries > 0) {
         log.error('Failed to get user mine data:', error.message);
         log.warn(`Retrying... (${retries - 1} attempts left)`);
         await sleep(3);
         return await getUser(token, retries - 1);
      } else {
         log.error('Failed to get user mine data after retries:', error.message);
         return null;
      }
   }
};

const main = async () => {
   log.info(banner);
   const wallets = readWallets();
   if (wallets.length === 0) {
      log.error('', 'No wallets found in wallets.json');
      process.exit(1);
   }

   while (true) {
      log.info(`Starting all wallets:`, wallets.length);

      for (const wallet of wallets) {
         const nonceData = await getNonce(wallet.address);
         if (!nonceData || !nonceData.data || !nonceData.data.nonce) {
            log.error(`Failed to retrieve nonce wallet: ${wallet.address}`);
            continue;
         }

         const nonce = nonceData.data.nonce;
         const signature = await signMessage(nonce, wallet.privateKey);
         if (!signature) {
            log.error(`Failed sign message wallet: ${wallet.address}`);
            continue;
         }
         log.info(`Login wallet: ${wallet.address}`);
         const loginResponse = await loginAcc(wallet.address, nonce, signature);
         if (!loginResponse || !loginResponse.token) {
            log.error(`Login failed wallet: ${wallet.address}`);
            continue;
         } else {
            log.info(`Login successful...`);
         }

         log.info(`Try to check user info...`);
         const userData = await getUser(loginResponse.token);
         if (userData && userData.data) {
            const { userId, twName, totalReward } = userData.data;
            log.info(`User Info:`, { userId, twName, totalReward });
            if (!twName) {
               log.error('', `This wallet (${wallet.address}) is not bound Twitter/X skipping...`);
               continue;
            }
         } else {
            log.error(`Failed to get user data wallet: ${wallet.address}`);
         }

         log.info('Try to check user miner status...');
         const minerStatus = await getMinerStatus(loginResponse.token);
         if (minerStatus && minerStatus.data) {
            const lastMiningTime = minerStatus.data?.lastMiningTime || 0;
            const nextMiningTime = lastMiningTime + 24 * 60 * 60;
            const nextDate = new Date(nextMiningTime * 1000);
            const dateNow = new Date();

            log.info(`Last mining time:`, new Date(lastMiningTime * 1000).toLocaleString());
            if (dateNow > nextDate) {
               log.info(`Try to start Mining wallet: ${wallet.address}`);
               const mineResponse = await startMine(loginResponse.token);
               log.info('Mine response:', mineResponse);
               if (mineResponse) {
                  log.info(`Try to activate mining on-chain wallet: ${wallet.address}`);
                  const isMiningSuccess = await contract(wallet.privateKey);
                  if (!isMiningSuccess) {
                     log.error(`Failed to activate mining or wallet dont have taker balance`);
                  }
               } else {
                  log.error(`Failed to  start mining wallet: ${wallet.address}`);
               }
            } else {
               log.warn(`Mining already , next mining time is:`, nextDate.toLocaleString());
            }
         }
      }

      log.info('All wallets processed delay 1 hour');
      await sleep(60 * 60);
   }
};

main();
