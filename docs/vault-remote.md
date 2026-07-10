# Private Knowledge Vault Remote

The Knowledge Vault contains derived full text and private research thinking.
Use a **private** remote repository by default.

```bash
git -C ~/papers remote add origin <PRIVATE_REMOTE>
git -C ~/papers push -u origin main
```

The plugin commits locally but does not push automatically. Network or
credential failures therefore never block a research turn.

To move the Vault to another machine:

1. Clone the complete private repository.
2. Configure the plugin Vault path to the cloned directory.
3. Open one paper and verify that `vault.json` is accepted and the existing
   `memory.md` and `record.json` files appear in Memory view.

Do not use a public remote without first removing copyrighted `text.txt` files
and private `conversations/` content.
