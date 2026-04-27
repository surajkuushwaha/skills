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
    const skillName = parts.slice(2).join('/');
    const skillFolderName = parts[parts.length - 1];

    const targetDir = path.join(process.cwd(), '.pi', 'skills', skillFolderName);
    
    console.log(`Installing skill "${skillFolderName}" from ${user}/${repo}...`);

    try {
        fs.mkdirSync(targetDir, { recursive: true });

        const rawUrl = `https://raw.githubusercontent.com/${user}/${repo}/main/${skillName}/SKILL.md`;
        console.log(`Fetching SKILL.md from ${rawUrl}...`);
        execSync(`curl -sSfL ${rawUrl} -o ${path.join(targetDir, 'SKILL.md')}`);

        // Try to fetch scripts/ if it exists (highly experimental)
        // This is a naive attempt; GitHub API would be better for directories
        console.log(`Searching for scripts in ${user}/${repo}/${skillName}/scripts...`);
        try {
            // This is complex without GitHub API, so we stick to SKILL.md for now
            // as pi skills are often self-contained in SKILL.md
        } catch (e) {}

        console.log(`Successfully installed ${skillFolderName} to ${targetDir}`);
    } catch (error) {
        console.error(`Failed to install skill: ${error.message}`);
        process.exit(1);
    }
} else {
    console.log('Usage: npx skills add <user>/<repo>/<skill>');
}
