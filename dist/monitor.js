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
exports.calculatepositon = exports.monitor = void 0;
const client_1 = require("@prisma/client");
const dlmm_sdk_1 = require("@saros-finance/dlmm-sdk");
const web3_js_1 = require("@solana/web3.js");
const axios_1 = __importDefault(require("axios"));
const telegraf_1 = require("telegraf");
const monitor = () => __awaiter(void 0, void 0, void 0, function* () {
    setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
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
            include: { user: { select: { telegram_id: true, public_key: true } } }
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
                // Check if position is out of range
                const isOutOfRange = activeBin < lowerBinId || activeBin > upperBinId;
                if (isOutOfRange) {
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
                        catch (_h) { }
                    }
                }
                else {
                    console.log(`✅ Position ${position.mint} is in range`);
                }
                // Calculate current position value
                const positionAddress = position.mint;
                const userPublicKey = (_b = position.user) === null || _b === void 0 ? void 0 : _b.public_key;
                if (!userPublicKey) {
                    console.log(`No public key found for position ${position.mint}`);
                    continue;
                }
                // Get token amounts from reserves
                const reserveInfo = yield liquidityBookService.getBinsReserveInformation({
                    position: new web3_js_1.PublicKey(positionAddress),
                    pair: new web3_js_1.PublicKey(marketAddress),
                    payer: new web3_js_1.PublicKey(userPublicKey)
                });
                // Calculate total token amounts
                let totalTokenX = 0;
                let totalTokenY = 0;
                reserveInfo.forEach(bin => {
                    totalTokenX += Number(bin.reserveX);
                    totalTokenY += Number(bin.reserveY);
                });
                // Get token prices from Jupiter API
                const tokenXMint = pairInfo.tokenMintX.toString();
                const tokenYMint = pairInfo.tokenMintY.toString();
                const priceResponse = yield axios_1.default.get(`https://api.jup.ag/price/v2?ids=${tokenXMint},${tokenYMint}`);
                const tokenXPrice = ((_d = (_c = priceResponse.data.data) === null || _c === void 0 ? void 0 : _c[tokenXMint]) === null || _d === void 0 ? void 0 : _d.price) || 0;
                const tokenYPrice = ((_f = (_e = priceResponse.data.data) === null || _e === void 0 ? void 0 : _e[tokenYMint]) === null || _f === void 0 ? void 0 : _f.price) || 0;
                // Get token decimals from pair info
                const poolMetadata = yield liquidityBookService.fetchPoolMetadata(marketAddress);
                const tokenXDecimals = poolMetadata.extra.tokenBaseDecimal;
                const tokenYDecimals = poolMetadata.extra.tokenQuoteDecimal;
                // Adjust for decimals
                const adjustedTokenX = totalTokenX / Math.pow(10, tokenXDecimals);
                const adjustedTokenY = totalTokenY / Math.pow(10, tokenYDecimals);
                // Calculate total USD value
                const currentValue = (adjustedTokenX * tokenXPrice) + (adjustedTokenY * tokenYPrice);
                console.log(`Position value: $${currentValue.toFixed(2)} (Token X: ${adjustedTokenX.toFixed(4)}, Token Y: ${adjustedTokenY.toFixed(4)})`);
                // Check if value changed by 10% or more
                const previousValue = position.Previous;
                if (previousValue > 0) {
                    const percentageChange = ((currentValue - previousValue) / previousValue) * 100;
                    if (Math.abs(percentageChange) >= 10) {
                        console.log(`🚨 Value change detected: ${percentageChange.toFixed(2)}%`);
                        const chatId = (_g = position.user) === null || _g === void 0 ? void 0 : _g.telegram_id;
                        if (chatId) {
                            const emoji = percentageChange > 0 ? "📈" : "📉";
                            const direction = percentageChange > 0 ? "increased" : "decreased";
                            const text = `${emoji} Position Value Alert!\n\n` +
                                `Your position has ${direction} by ${Math.abs(percentageChange).toFixed(2)}%\n\n` +
                                `• Position: ${position.mint}\n` +
                                `• Previous Value: $${previousValue.toFixed(2)}\n` +
                                `• Current Value: $${currentValue.toFixed(2)}\n` +
                                `• Token X: ${adjustedTokenX.toFixed(4)} @ $${tokenXPrice.toFixed(4)}\n` +
                                `• Token Y: ${adjustedTokenY.toFixed(4)} @ $${tokenYPrice.toFixed(4)}`;
                            try {
                                yield bot.telegram.sendMessage(chatId, text);
                            }
                            catch (error) {
                                console.error(`Failed to send alert to ${chatId}:`, error);
                            }
                        }
                        // Update the Previous value in database
                        yield prisma.position.update({
                            where: { id: position.id },
                            data: { Previous: currentValue }
                        });
                    }
                }
                else {
                    // First time monitoring, just set the current value
                    console.log(`Setting initial value: $${currentValue.toFixed(2)}`);
                    yield prisma.position.update({
                        where: { id: position.id },
                        data: { Previous: currentValue }
                    });
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
const calculatepositon = (positionAddress, pairAddress, tokenAMint, tokenBMint) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const liquidityBookService = new dlmm_sdk_1.LiquidityBookServices({
        mode: dlmm_sdk_1.MODE.MAINNET,
        options: {
            rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
        },
    });
    // Get the reserves (token amounts) for the position
    const reserves = yield liquidityBookService.getBinsReserveInformation({
        position: new web3_js_1.PublicKey(positionAddress),
        pair: new web3_js_1.PublicKey(pairAddress),
        payer: new web3_js_1.PublicKey("11111111111111111111111111111111") // Dummy payer for read-only
    });
    // Sum up all reserves across all bins
    let totalTokenA = 0;
    let totalTokenB = 0;
    reserves.forEach(reserve => {
        totalTokenA += Number(reserve.reserveX) || 0;
        totalTokenB += Number(reserve.reserveY) || 0;
    });
    console.log(`Token A amount: ${totalTokenA}`);
    console.log(`Token B amount: ${totalTokenB}`);
    // Get USD prices from Jupiter
    const response = yield axios_1.default.get(`https://lite-api.jup.ag/price/v3?ids=${tokenAMint},${tokenBMint}`);
    const data = response.data;
    const tokenAPrice = ((_a = data[tokenAMint]) === null || _a === void 0 ? void 0 : _a.usdPrice) || 0;
    const tokenBPrice = ((_b = data[tokenBMint]) === null || _b === void 0 ? void 0 : _b.usdPrice) || 0;
    // Calculate total USD value
    const totalValue = (totalTokenA * tokenAPrice) + (totalTokenB * tokenBPrice);
    return {
        tokenA: { amount: totalTokenA, price: tokenAPrice, value: totalTokenA * tokenAPrice },
        tokenB: { amount: totalTokenB, price: tokenBPrice, value: totalTokenB * tokenBPrice },
        totalValue
    };
});
exports.calculatepositon = calculatepositon;
