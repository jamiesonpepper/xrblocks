interface XRSystem {
  offerSession?: (
    mode: XRSessionMode,
    sessionInit?: XRSessionInit
  ) => Promise<XRSession>;
}
