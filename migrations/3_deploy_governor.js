const Governor = artifacts.require("xMockGovernor")

module.exports = function (deployer) {
  deployer.deploy(Governor)
}
