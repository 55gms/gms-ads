// The implementation lives inside the edge package so that package stays
// self-contained (zero dependencies, copyable on its own). The ad server
// imports the same functions from here.
export * from '../edge/lib/selection.js';
