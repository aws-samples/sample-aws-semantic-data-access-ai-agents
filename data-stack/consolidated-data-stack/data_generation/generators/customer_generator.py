import pandas as pd
import numpy as np
from faker import Faker
from datetime import datetime, timedelta
import random
import uuid
from typing import List, Dict

class CustomerGenerator:
    def __init__(self, seed: int = 42):
        self.fake = Faker()
        Faker.seed(seed)
        random.seed(seed)
        np.random.seed(seed)
        
        self.subscription_tiers = {
            'free_with_ads': {'price': 0, 'weight': 0.4},
            'basic': {'price': 8.99, 'weight': 0.3},
            'standard': {'price': 13.99, 'weight': 0.2},
            'premium': {'price': 19.99, 'weight': 0.1}
        }
        
        self.age_groups = {
            '18-24': 0.15,
            '25-34': 0.25,
            '35-44': 0.25,
            '45-54': 0.20,
            '55-64': 0.10,
            '65+': 0.05
        }
        
        self.payment_methods = {
            'credit_card': 0.6,
            'debit_card': 0.2,
            'paypal': 0.15,
            'apple_pay': 0.03,
            'google_pay': 0.02
        }
        
        self.acquisition_channels = {
            'organic_search': 0.25,
            'social_media': 0.20,
            'referral': 0.15,
            'paid_search': 0.15,
            'email': 0.10,
            'partner': 0.10,
            'other': 0.05
        }
        
        self.countries_data = {
            'United States': {'weight': 0.35, 'states': ['California', 'Texas', 'New York', 'Florida', 'Illinois']},
            'Canada': {'weight': 0.10, 'states': ['Ontario', 'Quebec', 'British Columbia', 'Alberta']},
            'United Kingdom': {'weight': 0.15, 'states': ['England', 'Scotland', 'Wales', 'Northern Ireland']},
            'Germany': {'weight': 0.10, 'states': ['Bavaria', 'Berlin', 'Hamburg', 'Hesse']},
            'France': {'weight': 0.08, 'states': ['Île-de-France', 'Provence', 'Normandy', 'Brittany']},
            'Japan': {'weight': 0.07, 'states': ['Tokyo', 'Osaka', 'Kyoto', 'Hokkaido']},
            'Australia': {'weight': 0.08, 'states': ['New South Wales', 'Victoria', 'Queensland', 'Western Australia']},
            'Brazil': {'weight': 0.07, 'states': ['São Paulo', 'Rio de Janeiro', 'Minas Gerais', 'Bahia']}
        }
        
        self.genres = [
            'Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Romance',
            'Thriller', 'Documentary', 'Animation', 'Fantasy', 'Crime', 'Mystery'
        ]
    
    def generate_customer(self, customer_index: int) -> Dict:
        customer_id = f"CUST_{str(uuid.uuid4())[:8]}_{customer_index:06d}"
        
        age_group = np.random.choice(
            list(self.age_groups.keys()),
            p=list(self.age_groups.values())
        )
        
        age = self._get_age_from_group(age_group)
        date_of_birth = datetime.now() - timedelta(days=age * 365)
        
        country = np.random.choice(
            list(self.countries_data.keys()),
            p=[c['weight'] for c in self.countries_data.values()]
        )
        state = random.choice(self.countries_data[country]['states'])
        
        subscription_tier = np.random.choice(
            list(self.subscription_tiers.keys()),
            p=[t['weight'] for t in self.subscription_tiers.values()]
        )
        
        payment_method = np.random.choice(
            list(self.payment_methods.keys()),
            p=list(self.payment_methods.values())
        )
        
        acquisition_channel = np.random.choice(
            list(self.acquisition_channels.keys()),
            p=list(self.acquisition_channels.values())
        )
        
        subscription_start = self.fake.date_time_between(start_date='-3y', end_date='now')
        
        if subscription_tier == 'free_with_ads':
            churn_probability = 0.3
        elif subscription_tier == 'basic':
            churn_probability = 0.2
        elif subscription_tier == 'standard':
            churn_probability = 0.1
        else:
            churn_probability = 0.05
        
        is_active = random.random() > churn_probability
        subscription_end = None if is_active else self.fake.date_time_between(
            start_date=subscription_start,
            end_date='now'
        )
        
        months_active = (datetime.now() - subscription_start).days / 30
        monthly_revenue = self.subscription_tiers[subscription_tier]['price']
        lifetime_value = monthly_revenue * months_active
        
        preferred_genres = random.sample(self.genres, k=random.randint(2, 5))
        
        return {
            'customer_id': customer_id,
            'email': self.fake.email(),
            'first_name': self.fake.first_name(),
            'last_name': self.fake.last_name(),
            'date_of_birth': date_of_birth.date(),
            'age_group': age_group,
            'subscription_tier': subscription_tier,
            'subscription_start_date': subscription_start,
            'subscription_end_date': subscription_end,
            'country': country,
            'state': state,
            'city': self.fake.city(),
            'timezone': self._get_timezone(country),
            'payment_method': payment_method,
            'monthly_revenue': monthly_revenue,
            'lifetime_value': lifetime_value,
            'is_active': is_active,
            'acquisition_channel': acquisition_channel,
            'preferred_genres': preferred_genres,
            'created_at': subscription_start,
            'updated_at': self.fake.date_time_between(
                start_date=subscription_start,
                end_date='now'
            )
        }
    
    def generate_customers(self, num_customers: int) -> pd.DataFrame:
        customers = []
        for i in range(num_customers):
            customers.append(self.generate_customer(i))
        
        df = pd.DataFrame(customers)
        return df
    
    def _get_age_from_group(self, age_group: str) -> int:
        age_ranges = {
            '18-24': (18, 24),
            '25-34': (25, 34),
            '35-44': (35, 44),
            '45-54': (45, 54),
            '55-64': (55, 64),
            '65+': (65, 80)
        }
        min_age, max_age = age_ranges[age_group]
        return random.randint(min_age, max_age)
    
    def _get_timezone(self, country: str) -> str:
        timezone_map = {
            'United States': 'America/New_York',
            'Canada': 'America/Toronto',
            'United Kingdom': 'Europe/London',
            'Germany': 'Europe/Berlin',
            'France': 'Europe/Paris',
            'Japan': 'Asia/Tokyo',
            'Australia': 'Australia/Sydney',
            'Brazil': 'America/Sao_Paulo'
        }
        return timezone_map.get(country, 'UTC')