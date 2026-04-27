#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

if (args[0] === 'add') {
    const skillPath = args[1];
    if (!skillPath) {
        console.error('Usage: npx skills add <user>/<repo>/<skill>');
        process.exit(1);
    }

    // Parse user/repo/skill
    // Example: mattpocock/skills/to-prd
    const parts = skillPath.split('/');
    if (parts.length < 3) {
        console.error('Invalid skill path. Expected format: user/repo/skill-name');
        process.exit(1);
    }

    const user = parts[0];
    const repo = parts[1];
    const skillName = parts.slice(2).join('/'); // Handle subdirectories if any

    const targetDir = path.join(process.cwd(), '.pi', 'skills', parts[parts.length - 1]);
    
    console.log(`Installing skill "${skillName}" from ${user}/${repo}...`);

    try {
        // Create target directory
        fs.mkdirSync(targetDir, { recursive: true });

        // Use curl to get the SKILL.md from raw.githubusercontent.com
        // Note: This assumes the skill is in the root or a simple subpath of the repo
        // and that it follows the SKILL.md naming convention.
        const rawUrl = `https://raw.githubusercontent.com/${user}/${repo}/main/${skillName}/SKILL.md`;
        
        console.log(`Fetching from ${rawUrl}...`);
        
        execSync(`curl -sSfL ${rawUrl} -o ${path.join(targetDir, 'SKILL.md')}`);
        
        console.log(`Successfully installed ${parts[parts.length - 1]} to ${targetDir}`);
    } catch (error) {
        console.error(`Failed to install skill: ${error.message}`);
        process.exit(1);
    }
} else {
    console.log('Usage: npx skills add <user>/<repo>/<skill>');
}
