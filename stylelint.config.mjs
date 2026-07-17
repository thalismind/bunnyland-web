export default {
  ignoreFiles: [
    'node_modules/**',
    'artifacts/**',
    'dist/**',
  ],
  overrides: [
    {
      files: ['**/*.html'],
      customSyntax: 'postcss-html',
    },
  ],
  rules: {
    'block-no-empty': true,
    'color-no-invalid-hex': true,
    'declaration-block-no-duplicate-custom-properties': true,
    'declaration-block-no-duplicate-properties': true,
    'font-family-no-duplicate-names': true,
    'function-calc-no-unspaced-operator': true,
    'keyframe-declaration-no-important': true,
    'media-feature-name-no-unknown': true,
    'named-grid-areas-no-invalid': true,
    'no-descending-specificity': null,
    'no-duplicate-at-import-rules': true,
    'no-duplicate-selectors': true,
    'no-invalid-position-at-import-rule': true,
    'no-unknown-animations': true,
    'property-no-unknown': true,
    'selector-pseudo-class-no-unknown': [true, {
      ignorePseudoClasses: ['global'],
    }],
    'selector-pseudo-element-no-unknown': true,
    'string-no-newline': true,
    'unit-no-unknown': true,
  },
};
