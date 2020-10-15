const fs = require("fs")
const path = require("path")

const OUTPUT_SELECTION = { "*": { "*": ["*"] } }

function buildInput(optimizerRuns, paths) {
  let input = {
    language: "Solidity",
    sources: {},
    settings: {
      optimizer: {
        enabled: optimizerRuns > 0,
        runs: optimizerRuns
      },
      outputSelection: OUTPUT_SELECTION
    }
  }
  for (let filePath of paths) {
    let basename = path.basename(filePath)
    input.sources[basename] = {
      content: fs.readFileSync(filePath, { encoding: "utf8" })
    }
  }
  return input
}

module.exports = [
  {
    // https://etherscan.io/address/0x988b3a538b618c7a603e1c11ab82cd16dbe28069
    solcVersion: "v0.4.25+commit.59dbf8f1",
    input: buildInput(200, ["./interaction-contracts/KlerosLiquid.sol"])
  },
  {
    // https://etherscan.io/address/0x93ed3fbe21207ec2e8f2d3c3de6e058cb73bc04d
    solcVersion: "v0.4.21+commit.dfe3193c",
    input: buildInput(200, ["./interaction-contracts/MiniMeToken.sol"])
  },
  {
    // https://etherscan.io/address/0xde4a25a0b9589689945d842c5ba0cf4f0d4eb3ac
    solcVersion: "v0.5.12+commit.7709ece9",
    input: buildInput(10000, ["./interaction-contracts/BActions.sol"])
  },
  {
    // https://etherscan.io/address/0x9424b1412450d0f8fc2255faf6046b98213b76bd
    solcVersion: "v0.5.12+commit.7709ece9",
    input: buildInput(2000, [
      "./interaction-contracts/BFactory.sol",
      "./interaction-contracts/BColor.sol",
      "./interaction-contracts/BConst.sol",
      "./interaction-contracts/BMath.sol",
      "./interaction-contracts/BNum.sol",
      "./interaction-contracts/BPool.sol",
      "./interaction-contracts/BToken.sol"
    ])
  },
  {
    // https://etherscan.io/address/0xc8ec08bf59fa9168ff4db6b5d406bd2ba0a78b77
    solcVersion: "v0.4.23+commit.124ca40d",
    input: buildInput(200, ["./interaction-contracts/DSProxy.sol"])
  },
  {
    // https://etherscan.io/address/0xc81d50c17754b379f1088574cf723be4fb00307d
    solcVersion: "v0.5.12+commit.7709ece9",
    input: buildInput(2000, [
      "./interaction-contracts/BPool.sol",
      "./interaction-contracts/BColor.sol",
      "./interaction-contracts/BConst.sol",
      "./interaction-contracts/BMath.sol",
      "./interaction-contracts/BNum.sol",
      "./interaction-contracts/BToken.sol"
    ])
  },
  {
    // https://etherscan.io/address/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
    solcVersion: "v0.4.19+commit.c4cbbb05",
    input: buildInput(0, ["./interaction-contracts/WETH9.sol"])
  },
  {
    solcVersion: "v0.5.12+commit.7709ece9",
    input: buildInput(200, ["./interaction-contracts/MockGovernor.sol"])
  }
]
