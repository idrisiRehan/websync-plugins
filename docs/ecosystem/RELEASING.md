# Releasing a package

Publishing to npm is an owner-approved action. Nothing in this repository publishes
automatically except when a release tag is pushed.

## One-time setup (owner)

1. Create the GitHub repository (see NAMING-REGISTER.md for the name) and push `main`.
2. Enable private vulnerability reporting (Settings, Security).
3. On npmjs.com, for each package, add a **trusted publisher**: GitHub Actions, this
   repository, workflow `release.yml`. For a package that has never been published, npm needs
   the first version published manually (step 5 below, run locally) before a trusted publisher
   can be linked, unless your npm account supports pending publishers.
4. Optional: enable "Require two-factor authentication and disallow tokens" on each package
   once trusted publishing works.

## Each release

1. Make sure `CHANGELOG.md` has the new version's section and today's date, and the version in
   `package.json` matches.
2. Run `npm run check` and `npm run check:pack`, and read the file list for the package.
3. Commit, then tag with the package name and version, and push:

   ```sh
   git tag security-header-audit@1.0.0
   git push origin main --tags
   ```

4. `release.yml` runs every check, confirms the tag matches `package.json`, publishes with
   provenance, and creates a GitHub release.
5. **Manual fallback** (first publish of a new name only): from the package folder, run
   `npm publish --access public` after `npm login`. `prepublishOnly` runs the tests and the build.

## After publishing

- `npm view <name>` shows the new version. Install it in a scratch folder and run the README's
  first example.
- Update ROADMAP.md (status `RELEASED`) and WORKLOG.md.
- Work through the distribution checklist in CONTENT-STRATEGY.md.
