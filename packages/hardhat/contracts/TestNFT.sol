// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract TestNFT is ERC721 {
    uint256 public nextId;

    constructor() ERC721("TestNFT", "TNFT") {}

    // anyone can mint in local dev
    function mint(address to) external {
        uint256 tokenId = ++nextId;
        _mint(to, tokenId);
    }
}