export interface Article {
    id: number;
    title: string;
    price: number;
    description: string;
    color: string;
    size: string[];
    season: string[];
    category: string;
    gender: 'male' | 'female' | 'mix'; // Added gender field
}

export const mockArticles: Article[] = [
    {
        id: 1,
        title: "Classic Denim Jacket",
        price: 89.99,
        description: "Versatile denim jacket with brass buttons and multiple pockets",
        color: "blue",
        size: ["XS", "S", "M", "L", "XL"],
        season: ["spring", "fall"],
        category: "outerwear",
        gender: "mix"
    },
    {
        id: 2,
        title: "Cotton Summer Dress",
        price: 45.99,
        description: "Lightweight floral print dress perfect for warm days",
        color: "yellow",
        size: ["S", "M", "L"],
        season: ["summer"],
        category: "dresses",
        gender: "female"
    },
    {
        id: 3,
        title: "Wool Sweater",
        price: 69.99,
        description: "Warm knitted sweater with ribbed collar and cuffs",
        color: "grey",
        size: ["M", "L", "XL"],
        season: ["winter", "fall"],
        category: "knitwear",
        gender: "mix"
    },
    {
        id: 4,
        title: "Linen Shorts",
        price: 34.99,
        description: "Comfortable linen shorts with elastic waistband",
        color: "beige",
        size: ["XS", "S", "M", "L"],
        season: ["summer", "spring"],
        category: "bottoms",
        gender: "mix"
    },
    {
        id: 5,
        title: "Rain Jacket",
        price: 79.99,
        description: "Waterproof jacket with hood and sealed seams",
        color: "green",
        size: ["S", "M", "L", "XL"],
        season: ["spring", "fall", "winter"],
        category: "outerwear",
        gender: "mix"
    },
];
