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
// Reuse singletons to avoid opening too many DB and network connections
const prisma = new client_1.PrismaClient();
const bot = new telegraf_1.Telegraf(process.env.TELEGRAM_API || "");
const liquidityBookService = new dlmm_sdk_1.LiquidityBookServices({
    mode: dlmm_sdk_1.MODE.MAINNET,
    options: {
        rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
    },
});
const monitor = () => __awaiter(void 0, void 0, void 0, function* () {
    setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        console.log("Starting position monitor...");
        const positions = yield prisma.position.findMany({
            include: { user: { select: { telegram_id: true, public_key: true, id: true } } }
        });
        console.log(`Found ${positions.length} positions to monitor`);
        // --- Sync any new on-chain positions into DB per (user, market) ---
        const uniqueCombos = new Map();
        for (const p of positions) {
            if (!((_a = p.user) === null || _a === void 0 ? void 0 : _a.public_key))
                continue;
            const key = `${p.user.id}:${p.Market}`;
            if (!uniqueCombos.has(key)) {
                uniqueCombos.set(key, { userId: p.user.id, wallet: p.user.public_key, market: p.Market });
            }
        }
        for (const { userId, wallet, market } of uniqueCombos.values()) {
            try {
                // Fetch on-chain positions for this user+market
                const onchainPositions = yield liquidityBookService.getUserPositions({
                    payer: new web3_js_1.PublicKey(wallet),
                    pair: new web3_js_1.PublicKey(market)
                });
                if (!(onchainPositions === null || onchainPositions === void 0 ? void 0 : onchainPositions.length))
                    continue;
                // Get pair info, decimals and current prices (for initial snapshot)
                const pairInfo = yield liquidityBookService.getPairAccount(new web3_js_1.PublicKey(market));
                const poolMetadata = yield liquidityBookService.fetchPoolMetadata(market);
                const tokenXMint = pairInfo.tokenMintX.toString();
                const tokenYMint = pairInfo.tokenMintY.toString();
                const tokenXDecimals = poolMetadata.extra.tokenBaseDecimal;
                const tokenYDecimals = poolMetadata.extra.tokenQuoteDecimal;
                const priceResponse = yield axios_1.default.get(`https://lite-api.jup.ag/price/v3?ids=${tokenXMint},${tokenYMint}`);
                const tokenXPrice = ((_c = (_b = priceResponse.data.data) === null || _b === void 0 ? void 0 : _b[tokenXMint]) === null || _c === void 0 ? void 0 : _c.price) || 0;
                const tokenYPrice = ((_e = (_d = priceResponse.data.data) === null || _d === void 0 ? void 0 : _d[tokenYMint]) === null || _e === void 0 ? void 0 : _e.price) || 0;
                // Get already stored mints for this user+market
                const existing = yield prisma.position.findMany({
                    where: { userId, Market: market },
                    select: { mint: true }
                });
                const existingMints = new Set(existing.map(e => e.mint));
                // For any new on-chain position not in DB, create it with initial snapshot
                for (const ocp of onchainPositions) {
                    const mintStr = ocp.positionMint.toString();
                    if (existingMints.has(mintStr))
                        continue;
                    // Compute initial reserves
                    const reserveInfo = yield liquidityBookService.getBinsReserveInformation({
                        position: new web3_js_1.PublicKey(ocp.position),
                        pair: new web3_js_1.PublicKey(market),
                        payer: new web3_js_1.PublicKey(wallet)
                    });
                    let totalTokenX = 0;
                    let totalTokenY = 0;
                    reserveInfo.forEach(bin => {
                        totalTokenX += Number(bin.reserveX);
                        totalTokenY += Number(bin.reserveY);
                    });
                    const initA = totalTokenX / Math.pow(10, tokenXDecimals);
                    const initB = totalTokenY / Math.pow(10, tokenYDecimals);
                    yield prisma.position.create({
                        data: {
                            userId,
                            mint: mintStr,
                            lowerId: ocp.lowerBinId.toString(),
                            upperId: ocp.upperBinId.toString(),
                            Market: market,
                            Status: 'Active',
                            Previous: 0.0,
                            initialTokenAAmount: initA,
                            initialTokenBAmount: initB,
                            initialTokenAPriceUSD: tokenXPrice,
                            initialTokenBPriceUSD: tokenYPrice,
                            lastILWarningPercent: 0.0
                        }
                    });
                    console.log(`Synced new position ${mintStr} for user ${userId} in market ${market}`);
                }
            }
            catch (e) {
                console.error(`Sync error for user ${userId} market ${market}:`, e);
            }
        }
        // --- Proceed with monitoring all stored positions ---
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
                    const chatId = (_f = position.user) === null || _f === void 0 ? void 0 : _f.telegram_id;
                    if (chatId) {
                        const text = `⚠️ Position out of range\n\n` +
                            `• Market: ${marketAddress}\n` +
                            `• Position Mint: ${position.mint}\n` +
                            `• Active Bin: ${activeBin}\n` +
                            `• Range: ${lowerBinId} - ${upperBinId}`;
                        try {
                            yield bot.telegram.sendMessage(chatId, text);
                        }
                        catch (_q) { }
                    }
                }
                else {
                    console.log(`✅ Position ${position.mint} is in range`);
                }
                const userPublicKey = (_g = position.user) === null || _g === void 0 ? void 0 : _g.public_key;
                if (!userPublicKey) {
                    console.log(`No public key found for position ${position.mint}`);
                    continue;
                }
                // Get all user positions for this pair to find the actual position account
                const poolPositions = yield liquidityBookService.getUserPositions({
                    payer: new web3_js_1.PublicKey(userPublicKey),
                    pair: new web3_js_1.PublicKey(marketAddress)
                });
                // Find the matching position by mint address
                const matchingPosition = poolPositions.find(p => p.positionMint.toString() === position.mint);
                if (!matchingPosition) {
                    console.log(`Position ${position.mint} not found in current user positions`);
                    continue;
                }
                // Use the actual position account address, not the mint
                const positionAddress = new web3_js_1.PublicKey(matchingPosition.position);
                // Get token amounts from reserves
                const reserveInfo = yield liquidityBookService.getBinsReserveInformation({
                    position: positionAddress,
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
                const priceResponse = yield axios_1.default.get(`https://lite-api.jup.ag/price/v3?ids=${tokenXMint},${tokenYMint}`);
                const tokenXPrice = ((_j = (_h = priceResponse.data.data) === null || _h === void 0 ? void 0 : _h[tokenXMint]) === null || _j === void 0 ? void 0 : _j.price) || 0;
                const tokenYPrice = ((_l = (_k = priceResponse.data.data) === null || _k === void 0 ? void 0 : _k[tokenYMint]) === null || _l === void 0 ? void 0 : _l.price) || 0;
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
                        const chatId = (_m = position.user) === null || _m === void 0 ? void 0 : _m.telegram_id;
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
                // ========== IMPERMANENT LOSS CALCULATION ==========
                const IL_THRESHOLD = -5; // 5% loss threshold
                const IL_NOTIFICATION_STEP = 2.5; // Only notify every 2.5% additional loss
                // Get initial data from database
                const { initialTokenAAmount, initialTokenBAmount, initialTokenAPriceUSD, initialTokenBPriceUSD, lastILWarningPercent } = position;
                // Only calculate IL if we have initial data
                if (initialTokenAAmount > 0 || initialTokenBAmount > 0) {
                    // Calculate "Value if Held" (HODL value)
                    const valueIfHeld = (initialTokenAAmount * tokenXPrice) + (initialTokenBAmount * tokenYPrice);
                    // Calculate Impermanent Loss Percentage
                    let impermanentLossPercentage = 0;
                    if (valueIfHeld > 0) {
                        impermanentLossPercentage = ((currentValue - valueIfHeld) / valueIfHeld) * 100;
                    }
                    console.log(`IL Check: Current: $${currentValue.toFixed(2)}, HODL: $${valueIfHeld.toFixed(2)}, IL: ${impermanentLossPercentage.toFixed(2)}%`);
                    // Check if IL threshold is crossed
                    if (impermanentLossPercentage <= IL_THRESHOLD) {
                        // Check if this is a new warning or IL got significantly worse
                        const ilDifference = Math.abs(impermanentLossPercentage - lastILWarningPercent);
                        const shouldNotify = lastILWarningPercent === 0 || ilDifference >= IL_NOTIFICATION_STEP;
                        if (shouldNotify) {
                            console.log(`🚨 IL Warning: ${impermanentLossPercentage.toFixed(2)}%`);
                            const chatId = (_o = position.user) === null || _o === void 0 ? void 0 : _o.telegram_id;
                            if (chatId) {
                                const emoji = impermanentLossPercentage < -10 ? "🔴" : "⚠️";
                                const ilAbsolute = Math.abs(impermanentLossPercentage);
                                const text = `${emoji} **Impermanent Loss Alert!**\n\n` +
                                    `Your position has an IL of **${ilAbsolute.toFixed(2)}%** compared to holding.\n\n` +
                                    `📊 **Position Details:**\n` +
                                    `• Position: ${position.mint}\n` +
                                    `• Current Value: $${currentValue.toFixed(2)}\n` +
                                    `• HODL Value: $${valueIfHeld.toFixed(2)}\n` +
                                    `• Difference: $${(currentValue - valueIfHeld).toFixed(2)}\n\n` +
                                    `💰 **Current Position:**\n` +
                                    `• Token X: ${adjustedTokenX.toFixed(4)} @ $${tokenXPrice.toFixed(4)}\n` +
                                    `• Token Y: ${adjustedTokenY.toFixed(4)} @ $${tokenYPrice.toFixed(4)}\n\n` +
                                    `🔒 **Initial (HODL):**\n` +
                                    `• Token X: ${initialTokenAAmount.toFixed(4)} @ $${initialTokenAPriceUSD.toFixed(4)}\n` +
                                    `• Token Y: ${initialTokenBAmount.toFixed(4)} @ $${initialTokenBPriceUSD.toFixed(4)}`;
                                try {
                                    yield bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                                }
                                catch (error) {
                                    console.error(`Failed to send IL alert to ${chatId}:`, error);
                                }
                            }
                            // Update the last IL warning percentage
                            yield prisma.position.update({
                                where: { id: position.id },
                                data: { lastILWarningPercent: impermanentLossPercentage }
                            });
                        }
                    }
                    else if (impermanentLossPercentage > 0 && lastILWarningPercent < 0) {
                        // IL has recovered to positive (user is now ahead)
                        console.log(`✅ IL Recovered: ${impermanentLossPercentage.toFixed(2)}%`);
                        const chatId = (_p = position.user) === null || _p === void 0 ? void 0 : _p.telegram_id;
                        if (chatId) {
                            const text = `✅ **Good News!**\n\n` +
                                `Your position IL has recovered!\n\n` +
                                `• Current Value: $${currentValue.toFixed(2)}\n` +
                                `• HODL Value: $${valueIfHeld.toFixed(2)}\n` +
                                `• You're ahead by: ${impermanentLossPercentage.toFixed(2)}%`;
                            try {
                                yield bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                            }
                            catch (error) {
                                console.error(`Failed to send IL recovery alert to ${chatId}:`, error);
                            }
                        }
                        // Reset the warning tracker
                        yield prisma.position.update({
                            where: { id: position.id },
                            data: { lastILWarningPercent: 0 }
                        });
                    }
                }
            }
            catch (error) {
                console.error(`Error checking position ${position.mint}:`, error);
            }
        }
        console.log("Monitor check complete");
    }), 900000); // 15 minutes
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
