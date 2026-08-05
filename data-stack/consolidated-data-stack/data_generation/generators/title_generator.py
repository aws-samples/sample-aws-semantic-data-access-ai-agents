import pandas as pd
import numpy as np
from faker import Faker
from datetime import datetime, timedelta
import random
import uuid
from typing import List, Dict

class TitleGenerator:
    def __init__(self, seed: int = 42):
        self.fake = Faker()
        Faker.seed(seed)
        random.seed(seed)
        np.random.seed(seed)
        
        self.title_types = {
            'movie': 0.6,
            'series': 0.3,
            'documentary': 0.1
        }
        
        self.genres = {
            'Action': {'weight': 0.15, 'sub_genres': ['Superhero', 'Martial Arts', 'War', 'Spy']},
            'Comedy': {'weight': 0.15, 'sub_genres': ['Romantic Comedy', 'Dark Comedy', 'Satire', 'Slapstick']},
            'Drama': {'weight': 0.20, 'sub_genres': ['Crime Drama', 'Legal Drama', 'Medical Drama', 'Period Drama']},
            'Horror': {'weight': 0.08, 'sub_genres': ['Supernatural', 'Slasher', 'Psychological', 'Zombie']},
            'Sci-Fi': {'weight': 0.10, 'sub_genres': ['Space Opera', 'Cyberpunk', 'Time Travel', 'Dystopian']},
            'Romance': {'weight': 0.10, 'sub_genres': ['Contemporary', 'Historical', 'Teen', 'LGBTQ+']},
            'Thriller': {'weight': 0.12, 'sub_genres': ['Psychological', 'Crime', 'Political', 'Techno']},
            'Documentary': {'weight': 0.05, 'sub_genres': ['Nature', 'True Crime', 'Biography', 'History']},
            'Animation': {'weight': 0.05, 'sub_genres': ['Family', 'Anime', 'Adult', 'Musical']}
        }
        
        self.content_ratings = {
            'G': 0.05,
            'PG': 0.15,
            'PG-13': 0.35,
            'R': 0.35,
            'NC-17': 0.10
        }
        
        self.production_countries = {
            'United States': 0.50,
            'United Kingdom': 0.15,
            'Canada': 0.08,
            'France': 0.06,
            'Germany': 0.05,
            'Japan': 0.06,
            'South Korea': 0.05,
            'India': 0.05
        }
        
        self.languages = {
            'English': 0.60,
            'Spanish': 0.10,
            'French': 0.08,
            'German': 0.05,
            'Japanese': 0.07,
            'Korean': 0.05,
            'Hindi': 0.05
        }
        
        self.studios = [
            'Acme Original Studios', 'Paramount Pictures', 'Warner Bros', 'Universal Studios',
            'Sony Pictures', '20th Century Studios', 'Disney Studios', 'Netflix Studios',
            'Amazon Studios', 'A24', 'Lionsgate', 'MGM', 'DreamWorks', 'Pixar'
        ]
        
        self.title_words = [
            'Shadow', 'Legacy', 'Chronicles', 'Rising', 'Fall', 'Last', 'First', 'Dark', 'Light',
            'Lost', 'Found', 'Secret', 'Hidden', 'Beyond', 'Edge', 'Heart', 'Soul', 'Mind',
            'Dream', 'Night', 'Day', 'Winter', 'Summer', 'Storm', 'Fire', 'Ice', 'Wind',
            'Earth', 'Sky', 'Star', 'Moon', 'Sun', 'Ocean', 'Mountain', 'Valley', 'City',
            'Kingdom', 'Empire', 'Quest', 'Journey', 'Path', 'Road', 'Bridge', 'Gate'
        ]
        
        self.first_names = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emma', 'Robert', 'Lisa']
        self.last_names = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis']
    
    def generate_title(self, title_index: int) -> Dict:
        title_id = f"TITLE_{str(uuid.uuid4())[:8]}_{title_index:06d}"
        
        title_type = np.random.choice(
            list(self.title_types.keys()),
            p=list(self.title_types.values())
        )
        
        genre = np.random.choice(
            list(self.genres.keys()),
            p=[g['weight'] for g in self.genres.values()]
        )
        sub_genre = random.choice(self.genres[genre]['sub_genres'])
        
        content_rating = np.random.choice(
            list(self.content_ratings.keys()),
            p=list(self.content_ratings.values())
        )
        
        production_country = np.random.choice(
            list(self.production_countries.keys()),
            p=list(self.production_countries.values())
        )
        
        original_language = np.random.choice(
            list(self.languages.keys()),
            p=list(self.languages.values())
        )
        
        available_languages = [original_language] + random.sample(
            [lang for lang in self.languages.keys() if lang != original_language],
            k=random.randint(1, 4)
        )
        
        if title_type == 'movie':
            duration_minutes = random.randint(80, 180)
            season_number = None  # Movies don't have seasons (will be NaN in Parquet, hence double type in Glue)
            episode_number = None  # Movies don't have episodes (will be NaN in Parquet, hence double type in Glue)
        elif title_type == 'series':
            duration_minutes = random.randint(20, 60)
            season_number = random.randint(1, 8)
            episode_number = random.randint(1, 24)
        else:  # documentary
            duration_minutes = random.randint(45, 120)
            season_number = None  # Documentaries don't have seasons (will be NaN in Parquet, hence double type in Glue)
            episode_number = None  # Documentaries don't have episodes (will be NaN in Parquet, hence double type in Glue)
        
        is_original = random.random() < 0.3
        studio = 'Acme Original Studios' if is_original else random.choice(self.studios[1:])
        
        popularity_score = np.random.beta(2, 5) * 100
        critical_rating = np.random.beta(3, 2) * 10
        viewer_rating = np.random.beta(3, 2) * 10
        
        if popularity_score > 70:
            budget_millions = random.uniform(50, 300)
            revenue_millions = budget_millions * random.uniform(1.5, 5)
        else:
            budget_millions = random.uniform(5, 50)
            revenue_millions = budget_millions * random.uniform(0.5, 3)
        
        awards_count = int(np.random.exponential(0.5)) if critical_rating > 7 else 0
        
        licensing_cost = 0 if is_original else random.uniform(0.5, 10) * (popularity_score / 10)
        
        release_date = self.fake.date_between(start_date='-20y', end_date='today')
        
        return {
            'title_id': title_id,
            'title_name': self._generate_title_name(genre),
            'title_type': title_type,
            'genre': genre,
            'sub_genre': sub_genre,
            'content_rating': content_rating,
            'release_date': release_date,
            'duration_minutes': duration_minutes,
            'season_number': season_number,
            'episode_number': episode_number,
            'production_country': production_country,
            'original_language': original_language,
            'available_languages': available_languages,
            'director': f"{random.choice(self.first_names)} {random.choice(self.last_names)}",
            'cast': [f"{random.choice(self.first_names)} {random.choice(self.last_names)}" 
                    for _ in range(random.randint(3, 8))],
            'production_studio': studio,
            'popularity_score': round(popularity_score, 2),
            'critical_rating': round(critical_rating, 1),
            'viewer_rating': round(viewer_rating, 1),
            'budget_millions': round(budget_millions, 2),
            'revenue_millions': round(revenue_millions, 2),
            'awards_count': awards_count,
            'is_original': is_original,
            'licensing_cost': round(licensing_cost, 2),
            'created_at': self.fake.date_time_between(start_date=release_date, end_date='now'),
            'updated_at': self.fake.date_time_between(start_date=release_date, end_date='now')
        }
    
    def generate_titles(self, num_titles: int) -> pd.DataFrame:
        titles = []
        for i in range(num_titles):
            titles.append(self.generate_title(i))
        
        df = pd.DataFrame(titles)
        return df
    
    def _generate_title_name(self, genre: str) -> str:
        templates = {
            'Action': ['The {0} {1}', '{0} of {1}', '{0}: {1} Rising'],
            'Comedy': ['{0} and {1}', 'The {0} Life', 'Adventures in {1}'],
            'Drama': ['The {0}', '{0} of the {1}', 'Beyond {0}'],
            'Horror': ['The {0} Within', '{0} at {1}', 'Night of the {0}'],
            'Sci-Fi': ['{0} {1}', 'Project {0}', '{0}: Year {1}'],
            'Romance': ['Love in {0}', 'The {0} of {1}', 'Forever {0}'],
            'Thriller': ['{0} Game', 'The {0} Protocol', '{0} Hour'],
            'Documentary': ['The {0} Story', 'Inside {0}', 'Truth About {0}'],
            'Animation': ['{0} Adventures', 'The {0} Kingdom', '{0} Friends']
        }
        
        template = random.choice(templates.get(genre, ['The {0} {1}']))
        words = random.sample(self.title_words, k=2)
        
        if '{1}' in template:
            title = template.format(words[0], words[1])
        else:
            title = template.format(words[0])
        
        if genre == 'Sci-Fi' and 'Year' in title:
            title = title.replace(words[1], str(random.randint(2050, 3000)))
        
        return title