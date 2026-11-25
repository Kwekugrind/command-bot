T=/home/ubuntu/trading-bots
{
echo "==64hex in bot tree (non-vendor)=="
grep -rInaoE "(0x)?[0-9a-f]{64}" $T 2>/dev/null | grep -viE "node_modules|package-lock|\.map|\.so|sha256|integrity|build-output" | head -40
echo "==keyword=="
grep -rInaiE "mnemonic|bip39|seed ?phrase|solana|keypair|id\.json|privateKey|private_key|secretKey|wallet|0x[0-9a-f]{40}" $T 2>/dev/null | grep -viE "node_modules|package-lock|\.map|build-output" | head -40
echo "==bashhist=="
grep -iE "wallet|mnemonic|private|solana|keypair|export |token|0x" /home/ubuntu/.bash_history 2>/dev/null | head -40
echo "==END=="
} > /tmp/_r.txt 2>&1
