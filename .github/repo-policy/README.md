# GitHub repository policy

These JSON files document the repository settings applied outside the git tree.

Apply from the repository root:

```powershell
gh api --method PATCH repos/cesar-carlos/plug_node -f delete_branch_on_merge=true
gh api --method PUT repos/cesar-carlos/plug_node/branches/main/protection --input .github/repo-policy/branch-protection-main.json
gh api --method POST repos/cesar-carlos/plug_node/rulesets --input .github/repo-policy/ruleset-limit-branch-creation.json
```

Verify:

```powershell
gh api repos/cesar-carlos/plug_node --jq "{delete_branch_on_merge, default_branch}"
gh api repos/cesar-carlos/plug_node/branches/main/protection --jq "{required_status_checks, allow_force_pushes, allow_deletions}"
gh api repos/cesar-carlos/plug_node/rulesets
```
