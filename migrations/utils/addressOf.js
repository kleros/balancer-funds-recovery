// Import this way
// require('./utils/addressOf')(accounts)

module.exports = (accounts) => {
  return {
    deployer: accounts[0],
    controller: accounts[1], // KlerosLiquid
    other: accounts[2],
    beneficiary: accounts[3], // multisig
    recovererDeployer: accounts[4]
  }
}
