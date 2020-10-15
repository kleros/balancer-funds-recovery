const pnkSettings = {
  tokenFactory: "0x0123456789abcDEF0123456789abCDef01234567", // unused
  parentToken: "0x0000000000000000000000000000000000000000",
  parentSnapshotBlock: 0,
  tokenName: "Pinakion",
  decimalUnits: 18,
  tokenSymbol: "PNK",
  transferEnabled: true
}

const WethToken = artifacts.require("xWETH9")
const PnkToken = artifacts.require("xMiniMeToken")

module.exports = function (deployer, network, accounts) {
  const addressOf = require("./utils/addressOf")(accounts)

  deployer.deploy(WethToken)
  deployer.deploy(
    PnkToken,
    pnkSettings.tokenFactory,
    pnkSettings.parentToken,
    pnkSettings.parentSnapshotBlock,
    pnkSettings.tokenName,
    pnkSettings.decimalUnits,
    pnkSettings.tokenSymbol,
    pnkSettings.transferEnabled,
    { from: addressOf.deployer } // deployer has controller rights
  )
}
