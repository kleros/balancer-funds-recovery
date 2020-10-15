const PnkToken = artifacts.require("xMiniMeToken")
const KlerosLiquid = artifacts.require("xKlerosLiquid")

module.exports = function (deployer) {
  const logTx = require("./utils/logTx")([PnkToken]).bind({ web3: web3 })

  let pnkToken

  deployer
    .then(async () => (pnkToken = await PnkToken.deployed()))
    .then(() => pnkToken.changeController(KlerosLiquid.address))
    .then(logTx)
}
