export const site = {
  name: 'OpenENV',
  specificationVersion: '0.1.0',
  status: 'DRAFT',
  description:
    'OpenENV — открытая спецификация контрактов переменных окружения. YAML, JSON, валидация и preview в VS Code.',
  github: 'https://github.com/it-perspectives/OpenENV',
  contributor: { name: 'Kolosov Aleksandr', url: 'https://github.com/dnwsilver' },
};

export const navigation = [
  { href: '/', icon: '◈', label: 'Обзор', count: '01' },
  { href: '/contract/', icon: '☷', label: 'Контракт', count: '07' },
  { href: '/types/', icon: '◇', label: 'Типы и правила', count: '05' },
  { href: '/quickstart/', icon: '›_', label: 'CLI и интеграция', count: '02' },
];

export const tools = [
  { href: '/vscode/', icon: '⊞', label: 'Open ENV · VS Code', badge: '0.2' },
  { href: '/SPEC.md', icon: '↗', label: 'Спецификация', external: true },
  { href: '/openenv-0.1.0.schema.json', icon: '↓', label: 'JSON Schema', download: true },
];
