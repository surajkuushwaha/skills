#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const args = process.argv.slice(2);

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'skills-cli' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return httpsGet(res.headers.location).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${url}`));
                else resolve(data);
            });
        }).on('error', reject);
    });
}

async function listSkillsInRepo(user, repo) {
    const apiUrl = `https://api.github.com/repos/${user}/${repo}/contents`;
    const data = JSON.parse(await httpsGet(apiUrl));
    return data
        .filter(item => item.type === 'dir' && !item.name.startsWith('.'))
        .map(item => item.name);
}

async function installSkill(user, repo, skillName, targetDir) {
    const skillDir = path.join(targetDir, skillName);
    fs.mkdirSync(skillDir, { recursive: true });

    const rawUrl = `https://raw.githubusercontent.com/${user}/${repo}/main/${skillName}/SKILL.md`;
    const content = await httpsGet(rawUrl);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
    console.log(`  ✓ ${skillName}`);
}

async function main() {
    if (args[0] !== 'add' || !args[1]) {
        console.log('Usage: npx skills add <user>/<repo>[/<skill>] [--target <dir>]');
        console.log('');
        console.log('Examples:');
        console.log('  npx skills add surajkuushwaha/skills           # install all skills');
        console.log('  npx skills add surajkuushwaha/skills/caveman   # install one skill');
        process.exit(args[0] ? 1 : 0);
    }

    const targetIdx = args.indexOf('--target');
    const targetDir = targetIdx !== -1 ? path.resolve(args[targetIdx + 1]) : process.cwd();

    const parts = args[1].split('/');
    const user = parts[0];
    const repo = parts[1];
    const skillName = parts[2];

    if (!user || !repo) {
        console.error('Invalid format. Expected: <user>/<repo>[/<skill>]');
        process.exit(1);
    }

    try {
        if (skillName) {
            console.log(`Installing ${skillName} from ${user}/${repo}...`);
            await installSkill(user, repo, skillName, targetDir);
        } else {
            console.log(`Installing all skills from ${user}/${repo}...`);
            const skills = await listSkillsInRepo(user, repo);
            for (const skill of skills) {
                try {
                    await installSkill(user, repo, skill, targetDir);
                } catch {
                    // skip dirs without SKILL.md (e.g. bin, scripts)
                }
            }
        }
        console.log(`\nInstalled to ${targetDir}`);
    } catch (err) {
        console.error(`Failed: ${err.message}`);
        process.exit(1);
    }
}

main();
