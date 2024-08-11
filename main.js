require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const glob = require('glob');

const SESSION_FOLDER = __dirname;

// Override console.error to ignore TIMEOUT errors
const originalConsoleError = console.error;
console.error = function (message, ...optionalParams) {
    if (typeof message === 'string' && message.includes('TIMEOUT')) {
        return; // Ignore TIMEOUT errors
    }
    originalConsoleError.apply(console, [message, ...optionalParams]);
};

// Global error handler to suppress uncaught TIMEOUT errors
process.on('uncaughtException', function (err) {
    if (err.message.includes('TIMEOUT')) {
        // Ignore TIMEOUT errors
        return;
    }
    console.error('Uncaught Exception:', err);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', function (reason, promise) {
    if (reason && reason.message && reason.message.includes('TIMEOUT')) {
        // Ignore TIMEOUT errors
        return;
    }
    console.error('Unhandled Rejection:', reason);
});

class OKX {
    constructor() {
        this.apiId = Number(process.env.API_ID); // Ensure apiId is a number
        this.apiHash = process.env.API_HASH;
        this.sessionPath = path.join(__dirname, 'session');
        this.dataPath = path.join(__dirname, 'data.txt');
        this.deviceModel = 'Galkurta OKX Racer';
        this.axiosInstance = axios.create({
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: true })
        });
        this.retryCount = 3;
        this.retryDelay = 1000;
    }

    headers() {
        return {
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "en-US,en;q=0.9",
            "App-Type": "web",
            "Content-Type": "application/json",
            "Origin": "https://www.okx.com",
            "Referer": "https://www.okx.com/mini-app/racer?tgWebAppStartParam=linkCode_31347852",
            "Sec-Ch-Ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Microsoft Edge";v="126"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
            "X-Cdn": "https://www.okx.com",
            "X-Locale": "en_US",
            "X-Utc": "7",
            "X-Zkdex-Env": "0"
        };
    }

    // Function to post data to OKX API
    async postToOKXAPI(extUserId, extUserName, queryId) {
        const url = `https://www.okx.com/priapi/v1/affiliate/game/racer/info?t=${Date.now()}`;
        const headers = { ...this.headers(), 'X-Telegram-Init-Data': queryId };
        const payload = {
            "extUserId": extUserId,
            "extUserName": extUserName,
            "gameId": 1,
            "linkCode": "88910038"
        };
        this.log(`POST to ${url} with payload:`, payload, false);
        return this.retryRequest(() => this.axiosInstance.post(url, payload, { headers }));
    }

    // Function to assess the prediction
    async assessPrediction(extUserId, predict, queryId) {
        const url = `https://www.okx.com/priapi/v1/affiliate/game/racer/assess?t=${Date.now()}`;
        const headers = { ...this.headers(), 'X-Telegram-Init-Data': queryId };
        const payload = {
            "extUserId": extUserId,
            "predict": predict,
            "gameId": 1
        };
        this.log(`POST to ${url} with payload:`, payload, false);
        return this.retryRequest(() => this.axiosInstance.post(url, payload, { headers }));
    }

    // Function to check daily rewards
    async checkDailyRewards(extUserId, queryId) {
        const url = `https://www.okx.com/priapi/v1/affiliate/game/racer/tasks?t=${Date.now()}`;
        const headers = { ...this.headers(), 'X-Telegram-Init-Data': queryId };
        this.log(`GET from ${url}`, null, false);
        try {
            const response = await this.retryRequest(() => this.axiosInstance.get(url, { headers }));
            if (response.data && response.data.data) {
                const tasks = response.data.data;
                const dailyCheckInTask = tasks.find(task => task.id === 4);
                if (dailyCheckInTask) {
                    if (dailyCheckInTask.state === 0) {
                        this.log('Start checkin ...');
                        await this.performCheckIn(extUserId, dailyCheckInTask.id, queryId);
                    } else {
                        this.log('Today you have attended!');
                    }
                }
            } else {
                this.log('Daily reward check error: No tasks found'.red);
            }
        } catch (error) {
            this.log(`Daily reward check error: ${error.message}`.red);
        }
    }

    // Function to perform check-in for daily rewards
    async performCheckIn(extUserId, taskId, queryId) {
        const url = `https://www.okx.com/priapi/v1/affiliate/game/racer/task?t=${Date.now()}`;
        const headers = { ...this.headers(), 'X-Telegram-Init-Data': queryId };
        const payload = {
            "extUserId": extUserId,
            "id": taskId
        };
        this.log(`POST to ${url} with payload:`, payload, false);
        try {
            await this.retryRequest(() => this.axiosInstance.post(url, payload, { headers }));
            this.log('Daily attendance successfully!'.green);
        } catch (error) {
            this.log(`Error: ${error.message}`.red);
        }
    }

    // Logging utility with filtered output
    log(msg, payload = null, showLog = true) {
        // Hide messages containing "GET" or "POST" to reduce clutter in the output
        if (showLog && !msg.includes("GET") && !msg.includes("POST")) {
            console.log(`[*] ${msg}`);
            if (payload) console.log(payload);
        }
    }

    // Utility function for sleep
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Countdown timer utility
    async waitWithCountdown(minutes) {
        for (let i = minutes; i >= 0; i--) {
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`===== Completed all accounts, waiting ${i} minutes to continue the loop =====`);
            await this.sleep(60000);
        }
        console.log('');
    }

    // Countdown in seconds
    async countdown(seconds) {
        for (let i = seconds; i >= 0; i--) {
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`[*] Wait ${i} seconds to continue ...`);
            await this.sleep(1000);
        }
        console.log('');
    }

    // Extract user data from the queryId
    extractUserData(queryId) {
        const urlParams = new URLSearchParams(queryId);
        const userParam = urlParams.get('user');
        if (!userParam) {
            throw new Error(`Invalid queryId: ${queryId}`);
        }
        const user = JSON.parse(decodeURIComponent(userParam));
        return {
            extUserId: user.id,
            extUserName: user.username
        };
    }

    // Retrieve boosts from OKX API
    async getBoosts(queryId) {
        const url = `https://www.okx.com/priapi/v1/affiliate/game/racer/boosts?t=${Date.now()}`;
        const headers = { ...this.headers(), 'X-Telegram-Init-Data': queryId };
        this.log(`GET from ${url}`, null, false);
        try {
            const response = await this.retryRequest(() => this.axiosInstance.get(url, { headers }));
            if (response.data && response.data.data) {
                return response.data.data;
            } else {
                this.log('Boost Information Error: No data found'.red);
                return [];
            }
        } catch (error) {
            this.log(`Boost Information Error: ${error.message}`.red);
            return [];
        }
    }

    // Function to use a boost
    async useBoost(queryId) {
        const url = `https://www.okx.com/priapi/v1/affiliate/game/racer/boost?t=${Date.now()}`;
        const headers = { ...this.headers(), 'X-Telegram-Init-Data': queryId };
        const payload = { id: 1 };
        this.log(`POST to ${url} with payload:`, payload, false);
        try {
            const response = await this.retryRequest(() => this.axiosInstance.post(url, payload, { headers }));
            if (response.data && response.data.code === 0) {
                this.log('Reload Fuel Tank successfully!'.yellow);
                await this.countdown(5);
            } else {
                this.log(`Error Reload Fuel Tank: ${response.data ? response.data.msg : 'Unknown error'}`.red);
            }
        } catch (error) {
            this.log(`Error: ${error.message}`.red);
        }
    }

    // Function to upgrade the fuel tank
    async upgradeFuelTank(queryId) {
        const url = `https://www.okx.com/priapi/v1/affiliate/game/racer/boost?t=${Date.now()}`;
        const headers = { ...this.headers(), 'X-Telegram-Init-Data': queryId };
        const payload = { id: 2 };
        this.log(`POST to ${url} with payload:`, payload, false);
        try {
            const response = await this.retryRequest(() => this.axiosInstance.post(url, payload, { headers }));
            if (response.data && response.data.code === 0) {
                this.log('Successful Fuel Tank upgrade!'.yellow);
            } else {
                this.log(`Fuel tank upgrade error: ${response.data ? response.data.msg : 'Unknown error'}`.red);
            }
        } catch (error) {
            this.log(`Error: ${error.message}`.red);
        }
    }

    // Function to upgrade the turbo charger
    async upgradeTurbo(queryId) {
        const url = `https://www.okx.com/priapi/v1/affiliate/game/racer/boost?t=${Date.now()}`;
        const headers = { ...this.headers(), 'X-Telegram-Init-Data': queryId };
        const payload = { id: 3 };
        this.log(`POST to ${url} with payload:`, payload, false);
        try {
            const response = await this.retryRequest(() => this.axiosInstance.post(url, payload, { headers }));
            if (response.data && response.data.code === 0) {
                this.log('Successful Turbo Charger upgrade!'.yellow);
            } else {
                this.log(`Turbo Charger upgrade error: ${response.data ? response.data.msg : 'Unknown error'}`.red);
            }
        } catch (error) {
            this.log(`Error: ${error.message}`.red);
        }
    }

    // Retrieve the current price from OKX API
    async getCurrentPrice() {
        const url = 'https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT';
        this.log(`GET from ${url}`, null, false);
        try {
            const response = await this.retryRequest(() => this.axiosInstance.get(url));
            if (response.data && response.data.data && response.data.data.length > 0) {
                return parseFloat(response.data.data[0].last);
            } else {
                throw new Error('No price data found');
            }
        } catch (error) {
            this.log(`Error getting current price: ${error.message}`.red);
            return null;
        }
    }

    // Create a new session with the option to name it
    async createSession(phoneNumber, sessionName) {
        try {
            if (typeof this.apiId !== 'number' || typeof this.apiHash !== 'string') {
                throw new Error('Invalid API credentials');
            }

            const client = new TelegramClient(
                new StringSession(""), 
                this.apiId, 
                this.apiHash, 
                { 
                    deviceModel: this.deviceModel, 
                    connectionRetries: 5 
                }
            );
            await client.start({
                phoneNumber: async () => phoneNumber,
                password: async () => await input.text('Enter your password: '),
                phoneCode: async () => await input.text('Enter the code you received: '),
                onError: err => {
                    if (!err.message.includes('TIMEOUT') && !err.message.includes('CastError')) {  // Ignore TIMEOUT and CastError errors
                        this.log(`Telegram authentication error: ${err.message}`.red);
                    }
                },
            });
            this.log('Successfully created a new session!'.green);
            const stringSession = client.session.save();
            const sessionId = sessionName || new Date().getTime();
            fs.writeFileSync(path.join(this.sessionPath, `session_${sessionId}.session`), stringSession);
            await client.sendMessage("me", { message: "Successfully created a new session!" });
            this.log('Saved the new session to session file.'.green);
            await client.disconnect();
        } catch (error) {
            if (!error.message.includes('TIMEOUT') && !error.message.includes('CastError')) {  // Ignore TIMEOUT and CastError errors
                this.log(`Error: ${error.message}`.red);
            }
        }
    }

    // Function to retrieve new query data and save it to data.txt
    async retrieveNewQueryData(sessionFile) {
        const sessionFilePath = path.join(this.sessionPath, `${sessionFile}`);
        try {
            const sessionString = fs.readFileSync(sessionFilePath, 'utf8');
            const client = new TelegramClient(
                new StringSession(sessionString), 
                this.apiId, 
                this.apiHash, 
                { 
                    deviceModel: this.deviceModel, 
                    connectionRetries: 5 
                }
            );
            await client.start({
                phoneNumber: async () => sessionFile,
                password: async () => await input.text('Enter your password: '),
                phoneCode: async () => await input.text('Enter the code you received: '),
                onError: err => {
                    if (!err.message.includes('TIMEOUT') && !err.message.includes('CastError')) {  // Ignore TIMEOUT and CastError errors
                        this.log(`Telegram authentication error: ${err.message}`.red);
                    }
                },
            });
            try {
                const peer = await client.getInputEntity('OKX_official_bot');
                if (!peer) {
                    this.log('Failed to get peer entity.'.red);
                    return;
                }
                const webview = await client.invoke(
                    new Api.messages.RequestWebView({
                        peer: peer,
                        bot: peer,
                        fromBotMenu: false,
                        platform: 'Android',
                        url: "https://www.okx.com/",
                    })
                );
                if (!webview || !webview.url) {
                    this.log('Failed to get webview URL.'.red);
                    return;
                }
                const query = decodeURIComponent(webview.url.split("&tgWebAppVersion=")[0].split("#tgWebAppData=")[1]);
                const currentData = fs.readFileSync(this.dataPath, 'utf8').split('\n').filter(Boolean);

                if (!currentData.includes(query)) {
                    // Save new query to the end of the file
                    fs.appendFileSync(this.dataPath, `${query}\n`);
                    this.log("Saved new query to data.txt".green);
                } else {
                    this.log("Query already exists in data.txt, skipping save.".yellow);
                }
            } catch (e) {
                this.log(`Error retrieving query data: ${e.message}`.red);
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            if (!error.message.includes('TIMEOUT') && !error.message.includes('CastError')) {  // Ignore TIMEOUT and CastError errors
                this.log(`Error: ${error.message}`.red);
            }
        }
    }

    // Function to replace a dead query in place
    async replaceDeadQuery(sessionFile, lineIndex) {
        const sessionFilePath = path.join(this.sessionPath, `${sessionFile}`);
        try {
            const sessionString = fs.readFileSync(sessionFilePath, 'utf8');
            const client = new TelegramClient(
                new StringSession(sessionString), 
                this.apiId, 
                this.apiHash, 
                { 
                    deviceModel: this.deviceModel, 
                    connectionRetries: 5 
                }
            );
            await client.start({
                phoneNumber: async () => sessionFile,
                password: async () => await input.text('Enter your password: '),
                phoneCode: async () => await input.text('Enter the code you received: '),
                onError: err => {
                    if (!err.message.includes('TIMEOUT') && !err.message.includes('CastError')) {  // Ignore TIMEOUT and CastError errors
                        this.log(`Telegram authentication error: ${err.message}`.red);
                    }
                },
            });
            try {
                const peer = await client.getInputEntity('OKX_official_bot');
                if (!peer) {
                    this.log('Failed to get peer entity.'.red);
                    return;
                }
                const webview = await client.invoke(
                    new Api.messages.RequestWebView({
                        peer: peer,
                        bot: peer,
                        fromBotMenu: false,
                        platform: 'Android',
                        url: "https://www.okx.com/",
                    })
                );
                if (!webview || !webview.url) {
                    this.log('Failed to get webview URL.'.red);
                    return;
                }
                const query = decodeURIComponent(webview.url.split("&tgWebAppVersion=")[0].split("#tgWebAppData=")[1]);
                let currentData = fs.readFileSync(this.dataPath, 'utf8').split('\n').filter(Boolean);

                if (!currentData.includes(query)) {
                    // Replace the dead query in place
                    currentData[lineIndex] = query;
                    fs.writeFileSync(this.dataPath, currentData.join('\n') + '\n');
                    this.log("Replaced dead query with new query in data.txt".green);
                } else {
                    this.log("Query already exists in data.txt, skipping save.".yellow);
                }
            } catch (e) {
                this.log(`Error retrieving query data: ${e.message}`.red);
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            if (!error.message.includes('TIMEOUT') && !error.message.includes('CastError')) {  // Ignore TIMEOUT and CastError errors
                this.log(`Error: ${error.message}`.red);
            }
        }
    }

    // Updated main function for retrieving query from session
    async getQueryFromSession() {
        const sessions = glob.sync(`${this.sessionPath}/session_*.session`);
        for (const session of sessions) {
            const sessionFile = path.basename(session);
            await this.retrieveNewQueryData(sessionFile);
        }
    }

    // Main loop for processing OKX queries
    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        let userData = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        const nangcapfueltank = await this.askQuestion('Do you want to upgrade Fuel Tank?(y/n): ');
        const hoinangcap = nangcapfueltank.toLowerCase() === 'y';
        const nangcapturbo = await this.askQuestion('Do you want to upgrade Turbo Charger?(y/n): ');
        const hoiturbo = nangcapturbo.toLowerCase() === 'y';

        const sessions = glob.sync(`${this.sessionPath}/session_*.session`);

        while (true) {
            if (userData.length === 0) {
                this.log("No queries found, attempting to retrieve queries...");
                await this.getQueryFromSession();
                userData = fs.readFileSync(dataFile, 'utf8')
                    .replace(/\r/g, '')
                    .split('\n')
                    .filter(Boolean);
            }

            for (let i = 0; i < userData.length; i++) {
                const queryId = userData[i];
                const { extUserId, extUserName } = this.extractUserData(queryId);
                let sessionFile = path.basename(sessions[i % sessions.length]); // Correctly format the sessionFile

                try {
                    this.log(`========== Account ${i + 1} | ${extUserName} ==========`.blue);
                    await this.checkDailyRewards(extUserId, queryId);

                    let boosts = await this.getBoosts(queryId);
                    boosts.forEach(boost => {
                        this.log(`${boost.context.name.green}: ${boost.curStage}/${boost.totalStage}`);
                    });

                    let reloadFuelTank = boosts.find(boost => boost.id === 1);
                    let fuelTank = boosts.find(boost => boost.id === 2);
                    let turbo = boosts.find(boost => boost.id === 3);

                    if (fuelTank && hoinangcap) {
                        const balanceResponse = await this.postToOKXAPI(extUserId, extUserName, queryId);
                        const balancePoints = balanceResponse.data.data.balancePoints;
                        if (fuelTank.curStage < fuelTank.totalStage && balancePoints > fuelTank.pointCost) {
                            await this.upgradeFuelTank(queryId);
                            boosts = await this.getBoosts(queryId);
                            const updatedFuelTank = boosts.find(boost => boost.id === 2);
                            const updatebalanceResponse = await this.postToOKXAPI(extUserId, extUserName, queryId);
                            const updatedBalancePoints = updatebalanceResponse.data.data.balancePoints;
                            if (updatedFuelTank.curStage >= fuelTank.totalStage || updatedBalancePoints < fuelTank.pointCost) {
                                this.log('Not eligible to upgrade Fuel Tank!'.red);
                                continue;
                            }
                        } else {
                            this.log('Not eligible to upgrade Fuel Tank!'.red);
                        }
                    }

                    if (turbo && hoiturbo) {
                        const balanceResponse = await this.postToOKXAPI(extUserId, extUserName, queryId);
                        const balancePoints = balanceResponse.data.data.balancePoints;
                        if (turbo.curStage < turbo.totalStage && balancePoints > turbo.pointCost) {
                            await this.upgradeTurbo(queryId);
                            boosts = await this.getBoosts(queryId);
                            const updatedTurbo = boosts.find(boost => boost.id === 3);
                            const updatebalanceResponse = await this.postToOKXAPI(extUserId, extUserName, queryId);
                            const updatedBalancePoints = updatebalanceResponse.data.data.balancePoints;
                            if (updatedTurbo.curStage >= turbo.totalStage || updatedBalancePoints < turbo.pointCost) {
                                this.log('Upgrading Turbo Charger failed!'.red);
                                continue;
                            }
                        } else {
                            this.log('Not eligible to upgrade Turbo Charger!'.red);
                        }
                    }

                    while (true) {
                        const price1 = await this.getCurrentPrice();
                        await this.sleep(4000);
                        const price2 = await this.getCurrentPrice();
                        let predict;
                        let action;
                        if (price1 > price2) {
                            predict = 0; // Sell
                            action = 'Sell';
                        } else {
                            predict = 1; // Buy
                            action = 'First';
                        }
                        const response = await this.postToOKXAPI(extUserId, extUserName, queryId);
                        const balancePoints = response.data.data.balancePoints;
                        this.log(`${'Balance Points:'.green} ${balancePoints}`);
                        const assessResponse = await this.assessPrediction(extUserId, predict, queryId);
                        const assessData = assessResponse.data.data;
                        const result = assessData.won ? 'Win'.green : 'Lose'.red;
                        const calculatedValue = assessData.basePoint * assessData.multiplier;
                        this.log(`Forecast ${action} | Result: ${result} x ${assessData.multiplier}! Balance: ${assessData.balancePoints}, Receive: ${calculatedValue}, Old price: ${assessData.prevPrice}, Current price: ${assessData.currentPrice}`.magenta);
                        if (assessData.numChance > 0) {
                            await this.countdown(1);
                        } else if (assessData.numChance <= 0 && reloadFuelTank && reloadFuelTank.curStage < reloadFuelTank.totalStage) {
                            await this.useBoost(queryId);
                            boosts = await this.getBoosts(queryId);
                            reloadFuelTank = boosts.find(boost => boost.id === 1);
                        } else {
                            break;
                        }
                    }
                } catch (error) {
                    this.log(`${'Error:'.red} ${error.message}`);
                    // If an error occurs, remove the dead query from data.txt
                    userData.splice(i, 1);
                    fs.writeFileSync(dataFile, userData.join('\n'));
                    // Attempt to retrieve new queries and replace in the same position
                    await this.replaceDeadQuery(sessionFile, i); // Ensure sessionFile is passed correctly
                    const newData = fs.readFileSync(dataFile, 'utf8')
                        .replace(/\r/g, '')
                        .split('\n')
                        .filter(Boolean);
                    userData = newData; // Update userData with the new data
                }
            }

            await this.waitWithCountdown(5); // Change this to the desired number of minutes
        }
    }

    // Ask a question in the console
    async askQuestion(query) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        return new Promise(resolve => rl.question(query, ans => {
            rl.close();
            resolve(ans);
        }));
    }

    // Retry the request a specified number of times
    async retryRequest(requestFunc, retries = this.retryCount) {
        for (let i = 0; i < retries; i++) {
            try {
                return await requestFunc();
            } catch (error) {
                if (i === retries - 1) {
                    throw error;
                }
                this.log(`Request failed with error: ${error.message}. Retrying in ${this.retryDelay / 1000} seconds...`);
                await this.sleep(this.retryDelay);
            }
        }
    }
}

// Start the process based on user input
if (require.main === module) {
    console.log(`
                     OKX Racer Script
                      Version: 1.0.0
                 Developed by: Galkurta
            GitHub: https://github.com/Galkurta
        ==========================================
           This script automates interaction with 
           the OKX API to handle tasks like checking 
           daily rewards, managing queries, and 
           upgrading boosts.
        ==========================================
           Use responsibly. The author is not 
           liable for any misuse of this code.
        `);
        
    const okx = new OKX();
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    const menu = `
    Please choose an option:
    1. Create session
    2. Get query from session
    3. Run 
    `;
    console.log(menu);
    rl.question('Choose mode: ', async (option) => {
        rl.close();
        if (option === "1") {
            const phoneNumber = await okx.askQuestion('Enter your phone number (+): ');
            const sessionName = await okx.askQuestion('Enter a name for this session (or leave blank for a timestamp): ');
            await okx.createSession(phoneNumber, sessionName);
        } else if (option === "2") {
            await okx.getQueryFromSession();
        } else if (option === "3") {
            await okx.main();
        } else {
            console.error('Invalid option');
        }
    });
}