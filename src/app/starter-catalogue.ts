// Curated starter catalogue (30 popular fragrances, 15 men + 15 ladies) sourced
// from Rumi in-stock oils. Prices are Rumi's "from" prices — adjust to your retail.
// Imported once via the admin Products tab "Import starter fragrances" button.

export interface StarterProduct {
  name: string;
  inspiredBy: string;
  gender: string;
  price: number;
  imageUrl: string;
}

export const STARTER_CATALOGUE: StarterProduct[] = [
  {
    "name": "Inspired By Creed Aventus",
    "inspiredBy": "Creed Aventus",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Sauvage Elixir",
    "inspiredBy": "Dior Sauvage Elixir",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Versace Eros",
    "inspiredBy": "Versace Eros",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Jean Paul Le Male",
    "inspiredBy": "JPG Le Male",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Boss Bottled",
    "inspiredBy": "Hugo Boss Bottled",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Aqua Dio Gio",
    "inspiredBy": "Armani Acqua di Gio",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Bvlgari Man In Black",
    "inspiredBy": "Bvlgari Man in Black",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Spicebomb",
    "inspiredBy": "Viktor&Rolf Spicebomb",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Green Irish Tweed",
    "inspiredBy": "Creed Green Irish Tweed",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Million Men Prive",
    "inspiredBy": "Paco Rabanne 1 Million Prive",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By 212 VIP Men",
    "inspiredBy": "Carolina Herrera 212 VIP Men",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Azzaro Wanted",
    "inspiredBy": "Azzaro Wanted",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Givenchy Gentleman",
    "inspiredBy": "Givenchy Gentleman",
    "gender": "Men",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Stronger With You Oud",
    "inspiredBy": "Armani Stronger With You Oud",
    "gender": "Men",
    "price": 125,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Tomford Tobacco Vanilla",
    "inspiredBy": "Tom Ford Tobacco Vanille",
    "gender": "Men",
    "price": 100,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Good Girl",
    "inspiredBy": "Carolina Herrera Good Girl",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By La Vie Este Belle",
    "inspiredBy": "Lancome La Vie Est Belle",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Alien",
    "inspiredBy": "Mugler Alien",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Angel",
    "inspiredBy": "Mugler Angel",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Armani SI",
    "inspiredBy": "Armani Si",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Olympea",
    "inspiredBy": "Paco Rabanne Olympea",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Mon Paris YSL",
    "inspiredBy": "YSL Mon Paris",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By De Marly Delina",
    "inspiredBy": "Parfums de Marly Delina",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Gucci Flora",
    "inspiredBy": "Gucci Flora",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Hypnotic Poison",
    "inspiredBy": "Dior Hypnotic Poison",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By D&G Light Blue",
    "inspiredBy": "Dolce & Gabbana Light Blue",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Chloe Eau De",
    "inspiredBy": "Chloe Eau de Parfum",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By 212 VIP Rose",
    "inspiredBy": "Carolina Herrera 212 VIP Rose",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By Bvlgari Rose Goldea",
    "inspiredBy": "Bvlgari Rose Goldea",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  },
  {
    "name": "Inspired By DKNY Be Delicious",
    "inspiredBy": "DKNY Be Delicious",
    "gender": "Women",
    "price": 80,
    "imageUrl": "https://rumifragrances.co.za/wp-content/uploads/2026/05/FINAL-pefume-oil-bottles-COVER-IMAGE.png"
  }
];
