# Claude Switcher

[![CI](https://github.com/dreamiurg/claude-switcher/actions/workflows/ci.yml/badge.svg)](https://github.com/dreamiurg/claude-switcher/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Switch between several claude.ai accounts in one Chrome profile, without signing in each time.

It remembers each account's claude.ai session cookies and swaps them in when you pick an account. Open an artifact link that belongs to your other account and it says so, with a button to open it there.

## Install

1. Download this repo (Code → Download ZIP) and unzip it, or `git clone` it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the folder.
3. Pin the extension.

## Use

1. Sign in to claude.ai and open the extension. The account is saved automatically.
2. Click **Add another account**, sign in to the next account, open the extension again.
3. From now on, click an account to switch to it.

Don't use claude.ai's **Log out** on a saved account. It ends that session on Anthropic's side and you'll have to sign in again. Use **Add another account** instead.

## Update

The popup shows your version and tells you when a newer one is out. To update, run `git pull` in the extension's folder (or download the ZIP again), then click the reload icon on the extension in `chrome://extensions`.

## Good to know

- Sessions are stored unencrypted in the extension's local storage, on your machine only. Anyone with access to your Chrome profile can use them.
- Account emails and the artifact check use claude.ai's internal API, which can change without notice. If it does, the extension stays quiet and switching still works.
- To find an artifact's account, the extension asks claude.ai with each saved account's session. That request goes only to claude.ai and doesn't change which account you're signed in as.
- Not affiliated with Anthropic.

## License

[MIT](LICENSE)
