"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatepositon = exports.PostionMonitor = exports.monitor = void 0;
const client_1 = require("@prisma/client");
const dlmm_sdk_1 = require("@saros-finance/dlmm-sdk");
const web3_js_1 = require("@solana/web3.js");
const axios_1 = __importDefault(require("axios"));
const telegraf_1 = require("telegraf");
const monitor = () => __awaiter(void 0, void 0, void 0, function* () {
    setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const prisma = new client_1.PrismaClient();
        console.log("Starting position monitor...");
        const bot = new telegraf_1.Telegraf(process.env.TELEGRAM_API || "");
        const liquidityBookService = new dlmm_sdk_1.LiquidityBookServices({
            mode: dlmm_sdk_1.MODE.MAINNET,
            options: {
                rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
            },
        });
        const positions = yield prisma.position.findMany({
            include: { user: { select: { telegram_id: true } } }
        });
        console.log(`Found ${positions.length} positions to monitor`);
        for (let i = 0; i < positions.length; i++) {
            const position = positions[i];
            const marketAddress = position.Market;
            try {
                console.log(`Checking position ${i + 1}: Market ${marketAddress}`);
                const pairInfo = yield liquidityBookService.getPairAccount(new web3_js_1.PublicKey(marketAddress));
                const activeBin = pairInfo.activeId;
                const lowerBinId = parseInt(position.lowerId);
                const upperBinId = parseInt(position.upperId);
                console.log(`Active bin: ${activeBin}, Position range: ${lowerBinId} - ${upperBinId}`);
                if (activeBin < lowerBinId || activeBin > upperBinId) {
                    console.log(`⚠️  Position ${position.mint} is out of range!`);
                    const chatId = (_a = position.user) === null || _a === void 0 ? void 0 : _a.telegram_id;
                    if (chatId) {
                        const text = `⚠️ Position out of range\n\n` +
                            `• Market: ${marketAddress}\n` +
                            `• Position Mint: ${position.mint}\n` +
                            `• Active Bin: ${activeBin}\n` +
                            `• Range: ${lowerBinId} - ${upperBinId}`;
                        try {
                            yield bot.telegram.sendMessage(chatId, text);
                        }
                        catch (_b) { }
                    }
                }
                else {
                    console.log(`✅ Position ${position.mint} is in range`);
                }
            }
            catch (error) {
                console.error(`Error checking position ${position.mint}:`, error);
            }
        }
        console.log("Monitor check complete");
    }), 900000);
});
exports.monitor = monitor;
const PostionMonitor = () => __awaiter(void 0, void 0, void 0, function* () {
    setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const prisma = new client_1.PrismaClient();
        console.log("Starting position monitor...");
        const bot = new telegraf_1.Telegraf(process.env.TELEGRAM_API || "");
        const liquidityBookService = new dlmm_sdk_1.LiquidityBookServices({
            mode: dlmm_sdk_1.MODE.MAINNET,
            options: {
                rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
            },
        });
        const positions = yield prisma.position.findMany({
            include: { user: { select: { telegram_id: true } } }
        });
        console.log(`Found ${positions.length} positions to monitor`);
        for (let i = 0; i < positions.length; i++) {
            const position = positions[i];
            const marketAddress = position.Market;
            try {
                console.log(`Checking position ${i + 1}: Market ${marketAddress}`);
                const pairInfo = yield liquidityBookService.getPairAccount(new web3_js_1.PublicKey(marketAddress));
                const activeBin = pairInfo.activeId;
                const lowerBinId = parseInt(position.lowerId);
                const upperBinId = parseInt(position.upperId);
                console.log(`Active bin: ${activeBin}, Position range: ${lowerBinId} - ${upperBinId}`);
                if (activeBin < lowerBinId || activeBin > upperBinId) {
                    console.log(`⚠️  Position ${position.mint} is out of range!`);
                    const chatId = (_a = position.user) === null || _a === void 0 ? void 0 : _a.telegram_id;
                    if (chatId) {
                        const text = `⚠️ Position out of range\n\n` +
                            `• Market: ${marketAddress}\n` +
                            `• Position Mint: ${position.mint}\n` +
                            `• Active Bin: ${activeBin}\n` +
                            `• Range: ${lowerBinId} - ${upperBinId}`;
                        try {
                            yield bot.telegram.sendMessage(chatId, text);
                        }
                        catch (_b) { }
                    }
                }
                else {
                    console.log(`✅ Position ${position.mint} is in range`);
                }
            }
            catch (error) {
                console.error(`Error checking position ${position.mint}:`, error);
            }
        }
        console.log("Monitor check complete");
    }), 900000);
});
exports.PostionMonitor = PostionMonitor;
const calculatepositon = (tokenA, tokenB, amounta, amountb) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const response = yield axios_1.default.get(`https://lite-api.jup.ag/price/v3?ids=${tokenA},${tokenB}`);
    const data = response.data;
    const tokenAPrice = (_a = data[tokenA]) === null || _a === void 0 ? void 0 : _a.usdPrice;
    const tokenBPrice = (_b = data[tokenB]) === null || _b === void 0 ? void 0 : _b.usdPrice;
    const price = (amounta * tokenAPrice) + (amountb * tokenBPrice);
    return price;
});
exports.calculatepositon = calculatepositon;
