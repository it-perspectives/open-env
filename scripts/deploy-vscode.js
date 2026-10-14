import { deployExtensionRelease } from './deploy.js';
try {
  const tag = deployExtensionRelease(process.argv.slice(2));
  console.log(`Pushed main and ${tag}. GitHub Actions will publish Open ENV to both stores.`);
} catch (error) { console.error(`Deploy failed: ${error.message}`); process.exitCode = 1; }
