# General

- [x] Mdquery --help info
- [ ] improved table view
  - [ ] use the clitables3 library or similar to create tables
  - [ ] intelligently utilize the terminal width - i.e consider how many columns a column will require and intelligently create layout, eg long lines content are in their own lines etc
- [x] install scripts - improve install script to check whether in the repo and if cli binary is built. if so, just copy to path, if not, fetch from github releases
- [ ] Docs with syntax, README, wiki - use caps in all docs for all keywords eg select becomes SELECT
- [ ] introduce keywords that work on file metadata eg mtime that reads a file's created/updated at metadata
- [ ] imporove ORDER BY to work with ASC AND DESC - ascending and descending
- [ ] implement trimAll() to strip/remove problematic characters
- [ ] implement config system to configure: default ignore dirs, default search depth, default view mode eg table or json

# CLI

- [ ] test the speed of piping find/fd into Mdquery and searching dirs with --dir cli argument
- [ ] --dir should be accept of comma separated list of dirs
- [ ] --dir should be able to handle dir substitution eg ~ is /home, . is current dir etc
- [ ] --dir should be able to handle env variables eg $XDG_CONFIG_HOME is /home/.config etc - should we pass these args to shell for substitution or handle them internally?
- [ ] full rewrite of table view
  - [ ] use library like cli-tables3 or tty-tables for tables and chalk for the color output
  - [ ] text formatting i.e make column titles bold
  - [ ] utilize the terminal width and use the collector data to determine if a column should be placed in newline
  - [ ] theming and colors - use current terminal colors or a specific theme
  - [ ] flags and args to control output eg wrap text, max number of rows etc, certain view modes for every field eg string for simple text, paragraph for long text, tree view for nested objects eg a table of contents with nested levels etc
- [ ] use alt-screen if results are many, alt-screen mode is a tui basically with keybindings for moving to next file, diff view etc
- [ ] --out/-o to save the results
- [ ] return syntax highlighted markdown with integration for codeblocks

# Extending md format

- [ ] add support for other md formats eg mdx, github flavoured markdown, obsidian etc
- [ ] add support for other md elements eg checklists
- [ ] add utility functions for some elements eg check/uncheck a checklist item

# Publishing

- [ ] publish to npm with both library and cli
- [ ] publish to arch aur with install scripts for cli binary

# Tests

- [ ] find/fd md files in ~/.agents/skills/ ~/opt/skills/ ~/opt/my-skills/, then pipe them into Mdquery, use trimAll to strip problematic characters and return:
  - [ ] a table/json returning name and description of all skill files
  - [ ] name, and table of contents
  - [ ] name, and first section
  - [ ] order by date/time that file was modified
  - [ ] abspath, name as json results then pipe them to fzf as list of names, abspath is first hidden field, then preview script uses bat to preview the file with the abspath as arg
- [ ] search md files with embeded codeblocks and return:
  - [ ] filename, and boolean if the file contains codeblocks/ return only filenames that contain codeblocks
  - [ ] filename, and codeblocks grouped by language eg python, js etc
  - [ ] filename, and all the codeblocks in the file
  - [ ] filename, and only python codeblocks in the file
  - [ ] filename, and the entire section for each codeblock, aggregate codeblocks per section, section name as title
- [ ] md files with links and img tags and return:
  - [ ] filename and all the links in file
  - [ ] filename and all links that match 'github'
  - [ ] filename and all img links with href in one column and target url in another column
  - [ ] filename and entire paragraph containing link, aggregate by paragraph/section with section title as title of column
  - [ ] filename and entire sentence that contains link with line number
