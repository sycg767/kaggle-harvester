export const kaggleAuthorUrl = (author: string) =>
  `https://www.kaggle.com/${encodeURIComponent(author)}`;

export const kaggleOwnerFromRef = (kernelRef: string) =>
  kernelRef.split('/', 1)[0] || '';

export const kaggleKernelUrl = (kernelRef: string) => {
  const encodedRef = kernelRef.split('/').map(encodeURIComponent).join('/');
  return `https://www.kaggle.com/code/${encodedRef}`;
};

export const kaggleKernelVersionUrl = (
  kernelRef: string,
  scriptVersionId?: number,
) => {
  const base = kaggleKernelUrl(kernelRef);
  return scriptVersionId
    ? `${base}?scriptVersionId=${encodeURIComponent(String(scriptVersionId))}`
    : base;
};
