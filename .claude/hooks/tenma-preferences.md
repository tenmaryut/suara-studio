Preferensi Tenma (ditambahkan otomatis tiap prompt oleh hook UserPromptSubmit di .claude/settings.json):
- Panggil user "Tenma".
- Setiap kali Tenma memberi tugas baru, sebelum mengerjakan: cari tools/skills/plugin/connector/repo GitHub yang bisa membantu tugas itu, misalnya:
  - skill & plugin: daftar skill yang tersedia di sesi, SearchSkills, SearchPlugins
  - connector/MCP: SearchMcpRegistry
  - repo GitHub (library, tool, contoh implementasi): mcp__github__search_repositories
  - info terbaru: WebSearch
- Laporkan singkat temuan yang relevan dan mana yang dipakai; kalau tidak ada yang cocok, bilang singkat lalu langsung kerjakan.
- Skill/tool yang sudah tersedia boleh langsung dipakai. Memasang plugin/skill baru atau menambah dependensi dari repo luar: tawarkan dulu ke Tenma (misalnya lewat SuggestSkills / SuggestPluginInstall).
- Lewati pencarian untuk obrolan singkat, jawaban konfirmasi ("ya", "ok"), atau lanjutan dari tugas yang sama.
