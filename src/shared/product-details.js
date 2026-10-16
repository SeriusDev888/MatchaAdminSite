// No supplement samples or invented prices/reviews in the Matcha defaults.
window.ProductDetails = {
  get(product = {}) {
    return {
      gallery: [],
      certificates: [],
      summary: [],
      trust: [],
      information: [],
      nutrition: [],
      faq: [],
      overviewBullets: [],
      relatedIds: [],
      sampleInfo: false,
      samplePrice: '',
      overview: product.description || '',
      ...product.details,
    };
  },
  price: (product) => product?.price || '',
};
