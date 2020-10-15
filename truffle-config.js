module.exports = {
  networks: {
    test: {
      gas: 12400000,
      host: "localhost",
      network_id: "*",
      port: 8545
    }
  },
  compilers: {
    solc: {
      // Compiles Recoverer.sol
      version: "0.6.5",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        }
      }
    },
    external: {
      // Compiles the other contracts
      command: "node external-compiler.js",
      targets: [
        {
          path: "./output/*.json"
        }
      ]
    }
  }
}
