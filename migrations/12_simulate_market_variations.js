const settings = {
  poolDenorm: "25000000000000000000",
  poolSwapFee: "1000000000000000", // 0.1%
  targetWethBalance: "1497869045760000000000", // 1,497.869 WETH
  targetPnkBalance: "7481018020279440000000000" // 7,481,018.020 PNK
}

const BPool = artifacts.require("xBPool")
const PnkToken = artifacts.require("xMiniMeToken")
const WethToken = artifacts.require("xWETH9")

module.exports = function (deployer, network, accounts) {
  const addressOf = require("./utils/addressOf")(accounts)
  const logTx = require("./utils/logTx")([BPool, PnkToken, WethToken]).bind({ web3: web3 })

  // Instances
  let pool
  let pnkToken
  let wethToken

  // Computations
  let currentWethBalance
  let currentPnkBalance
  let amount

  deployer
    .then(async () => {
      pool = await BPool.deployed()
      pnkToken = await PnkToken.deployed()
      wethToken = await WethToken.deployed()
      currentWethBalance = await pool.getBalance(WethToken.address)
      currentPnkBalance = await pool.getBalance(PnkToken.address)
    })
    .then(async () => {
      // Set WETH balance
      let tx
      if (BigInt(settings.targetWethBalance) < BigInt(currentWethBalance)) {
        // Swap WETH out of the pool
        amount = await pool.calcInGivenOut(
          currentPnkBalance,
          settings.poolDenorm,
          currentWethBalance,
          settings.poolDenorm,
          (BigInt(currentWethBalance) - BigInt(settings.targetWethBalance)).toString(),
          settings.poolSwapFee
        )

        tx = await pnkToken.generateTokens(addressOf.other, amount, { from: addressOf.deployer })
        await logTx(tx)
        tx = await pnkToken.approve(BPool.address, amount, { from: addressOf.other })
        await logTx(tx)
        tx = await pool.swapExactAmountIn(
          PnkToken.address,
          amount,
          WethToken.address,
          0,
          (2n ** 256n - 1n).toString(),
          { from: addressOf.other }
        )
        await logTx(tx)
      } else {
        // Swap WETH into the pool
        amount = (BigInt(settings.targetWethBalance) - BigInt(currentWethBalance)).toString()

        tx = await wethToken.deposit({ from: addressOf.other, value: amount })
        await logTx(tx)
        tx = await wethToken.approve(BPool.address, amount, { from: addressOf.other })
        await logTx(tx)
        tx = await pool.swapExactAmountIn(
          WethToken.address,
          amount,
          PnkToken.address,
          0,
          (2n ** 256n - 1n).toString(),
          { from: addressOf.other }
        )
        await logTx(tx)
      }
    })
    .then(async () => (currentPnkBalance = await pool.getBalance(PnkToken.address)))
    .then(async () => {
      // Set PNK balance
      let tx
      if (BigInt(settings.targetPnkBalance) > BigInt(currentPnkBalance)) {
        // Give PNK to the pool
        tx = await pnkToken.generateTokens(
          BPool.address,
          (BigInt(settings.targetPnkBalance) - BigInt(currentPnkBalance)).toString(),
          { from: addressOf.deployer }
        )
        await logTx(tx)
      } else {
        tx = await pnkToken.transferFrom(
          // Draw PNK from the pool
          BPool.address,
          "0x0000000000000000000000000000000000000000",
          (BigInt(currentPnkBalance) - BigInt(settings.targetPnkBalance)).toString(),
          { from: addressOf.deployer }
        )
        await logTx(tx)
      }
    })
    .then(async () => pool.gulp(PnkToken.address)) // Update pool's internal balance
    .then(logTx)
}
