com:
	npx hardhat compile

call:
	node shortcuts/call.js

t:
	npx hardhat test test/test.ts 

deploy:
	npx hardhat run --network ${chain} scripts/deploy.ts