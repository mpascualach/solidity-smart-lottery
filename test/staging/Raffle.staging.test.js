const { assert, expect } = require("chai");
const { getNamedAccounts, network, ethers } = require("hardhat");
const { developmentChains } = require("../../helper-hardhat-config");

developmentChains.includes(network.name) // if on a development network (i.e. hardhat, localhost)
  ? describe.skip // skip all tests
  : describe("Raffle Unit Tests", function () {
      let raffle, raffleEntranceFee, deployer;

      beforeEach(async () => {
        deployer = (await getNamedAccounts()).deployer;
        raffle = await ethers.getContract("Raffle", deployer);
        raffleEntranceFee = await raffle.getEntranceFee();
      });

      describe("fulfillRandomWords", function () {
        it("works with live Chainlink keepers and Chainlink VRF, we get a random winner", async function () {
          // enter the raffle
          const startingTimeStamp = await raffle.getLastTimeStamp();
          const accounts = await ethers.getSigners();

          await new Promise(async (resolve, reject) => {
            raffle.once("WinnerPicked", async () => {
              console.log("WinnerPicked event fired!");
              try {
                const recentWinner = await raffle.getRecentWinner();
                console.log("Recent winner: ", recentWinner);
                const raffleState = await raffle.getRaffleState();
                console.log("Raffle state: ", raffleState);
                const winnerEndingBalance = await accounts[0].getBalance();
                console.log("Winner ending balance: ", winnerEndingBalance);
                const endingTimeStamp = await raffle.getLatestTimeStamp();
                console.log("Ending time stamp: ", endingTimeStamp);

                await expect(raffle.getPlayer(0)).to.be.reverted;
                console.log("Players cleared out");
                assert.equal(recentWinner.toString(), accounts[0].address);
                console.log("Winner addressed");
                assert.equal(raffleState, 0);
                console.log("Raffle reopened");
                assert.equal(
                  winnerEndingBalance.toString(),
                  winnerStartingBalance.add(raffleEntranceFee)
                );
                console.log("Winner starting balance reset");
                assert(endingTimeStamp > startingTimeStamp);
                resolve();
              } catch (e) {
                console.log(e);
                reject(e);
              }
            });
            // then entering the raffle
            console.log("Entering the raffle");
            await raffle.enterRaffle({ value: raffleEntranceFee });
            await tx.wait(1);
            console.log("Ok, time to wait");
            const winnerStartingBalance = await accounts[0].getBalance();

            // this code won't complete until our listener has finished listening
          });
        });
      });
    });
