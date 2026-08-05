import pandas as pd
import numpy as np
from faker import Faker
from datetime import datetime, timedelta
import random
import uuid
from typing import List, Dict, Tuple
import json

class TelemetryGenerator:
    def __init__(self, customers_df: pd.DataFrame, titles_df: pd.DataFrame, seed: int = 42):
        self.fake = Faker()
        Faker.seed(seed)
        random.seed(seed)
        np.random.seed(seed)
        
        self.customers_df = customers_df
        self.titles_df = titles_df
        
        self.event_types = ['start', 'pause', 'resume', 'stop', 'complete']
        
        self.device_types = {
            'tv': {'weight': 0.40, 'os': ['Roku OS', 'Fire TV', 'Apple TV', 'Android TV', 'Smart TV OS']},
            'mobile': {'weight': 0.30, 'os': ['iOS', 'Android']},
            'tablet': {'weight': 0.15, 'os': ['iOS', 'Android']},
            'web': {'weight': 0.15, 'os': ['Windows', 'macOS', 'Linux', 'ChromeOS']}
        }
        
        self.quality_by_tier = {
            'free_with_ads': {'SD': 0.7, 'HD': 0.3, '4K': 0.0},
            'basic': {'SD': 0.3, 'HD': 0.7, '4K': 0.0},
            'standard': {'SD': 0.1, 'HD': 0.6, '4K': 0.3},
            'premium': {'SD': 0.05, 'HD': 0.35, '4K': 0.6}
        }
        
        self.bandwidth_ranges = {
            'SD': (2, 5),
            'HD': (5, 10),
            '4K': (15, 30)
        }
        
        self.connection_types = {
            'fiber': 0.25,
            'cable': 0.35,
            'dsl': 0.20,
            'mobile': 0.15,
            'satellite': 0.05
        }
        
        self.isps = [
            'Comcast', 'AT&T', 'Verizon', 'Spectrum', 'Cox', 'CenturyLink',
            'Frontier', 'Optimum', 'Mediacom', 'Windstream'
        ]
        
        self.app_versions = ['5.2.1', '5.2.0', '5.1.9', '5.1.8', '5.0.0', '4.9.5']
        
        self.hourly_weights = self._generate_hourly_weights()
        
        self.completion_rates = {
            'movie': {'complete': 0.7, 'partial': 0.3},
            'series': {'complete': 0.8, 'partial': 0.2},
            'documentary': {'complete': 0.6, 'partial': 0.4}
        }
    
    def generate_telemetry_events(self, num_events: int, date_range_days: int = 30) -> pd.DataFrame:
        events = []
        
        active_customers = self.customers_df[self.customers_df['is_active']].copy()
        
        for _ in range(num_events):
            event = self._generate_single_event(active_customers, date_range_days)
            events.append(event)
        
        df = pd.DataFrame(events)
        df = df.sort_values('event_timestamp')
        return df
    
    def _generate_single_event(self, active_customers: pd.DataFrame, date_range_days: int) -> Dict:
        customer = active_customers.sample(1).iloc[0]
        
        preferred_genres = customer['preferred_genres']
        if isinstance(preferred_genres, str):
            preferred_genres = json.loads(preferred_genres)
        
        genre_titles = self.titles_df[self.titles_df['genre'].isin(preferred_genres)]
        other_titles = self.titles_df[~self.titles_df['genre'].isin(preferred_genres)]
        
        if random.random() < 0.8 and len(genre_titles) > 0:
            title = genre_titles.sample(1).iloc[0]
        else:
            title = other_titles.sample(1).iloc[0]
        
        event_timestamp = self._generate_timestamp(date_range_days)
        
        device_type = np.random.choice(
            list(self.device_types.keys()),
            p=[d['weight'] for d in self.device_types.values()]
        )
        device_os = random.choice(self.device_types[device_type]['os'])
        
        quality_options = self.quality_by_tier[customer['subscription_tier']]
        quality = np.random.choice(
            list(quality_options.keys()),
            p=list(quality_options.values())
        )
        
        bandwidth_min, bandwidth_max = self.bandwidth_ranges[quality]
        bandwidth_mbps = random.uniform(bandwidth_min, bandwidth_max)
        
        session_id = f"SESSION_{str(uuid.uuid4())[:8]}"
        
        viewing_session = self._generate_viewing_session(title, quality)
        
        connection_type = np.random.choice(
            list(self.connection_types.keys()),
            p=list(self.connection_types.values())
        )
        
        return {
            'event_id': f"EVENT_{str(uuid.uuid4())[:8]}",
            'customer_id': customer['customer_id'],
            'title_id': title['title_id'],
            'session_id': session_id,
            'event_type': viewing_session['event_type'],
            'event_timestamp': event_timestamp,
            'watch_duration_seconds': viewing_session['watch_duration'],
            'position_seconds': viewing_session['position'],
            'completion_percentage': viewing_session['completion_percentage'],
            'title_type': title['title_type'],
            'device_type': device_type,
            'device_id': f"DEVICE_{str(uuid.uuid4())[:8]}",
            'device_os': device_os,
            'app_version': random.choice(self.app_versions),
            'quality': quality,
            'bandwidth_mbps': round(bandwidth_mbps, 2),
            'buffering_events': viewing_session['buffering_events'],
            'buffering_duration_seconds': viewing_session['buffering_duration'],
            'error_count': viewing_session['error_count'],
            'ip_address': self.fake.ipv4(),
            'country': customer['country'],
            'state': customer['state'],
            'city': customer['city'],
            'isp': random.choice(self.isps),
            'connection_type': connection_type
        }
    
    def _generate_viewing_session(self, title: pd.Series, quality: str) -> Dict:
        title_duration_seconds = title['duration_minutes'] * 60
        title_type = title['title_type']
        
        completion_prob = self.completion_rates[title_type]
        is_complete = random.random() < completion_prob['complete']
        
        if is_complete:
            watch_duration = int(title_duration_seconds * random.uniform(0.85, 1.0))
            position = title_duration_seconds
            completion_percentage = min(100, (watch_duration / title_duration_seconds) * 100)
            event_type = 'complete'
        else:
            watch_percentage = random.uniform(0.1, 0.8)
            watch_duration = int(title_duration_seconds * watch_percentage)
            position = watch_duration
            completion_percentage = watch_percentage * 100
            event_type = 'stop'
        
        if quality == '4K':
            buffering_prob = 0.1
            error_prob = 0.02
        elif quality == 'HD':
            buffering_prob = 0.05
            error_prob = 0.01
        else:
            buffering_prob = 0.02
            error_prob = 0.005
        
        buffering_events = np.random.poisson(buffering_prob * (watch_duration / 60))
        buffering_duration = buffering_events * random.randint(2, 10) if buffering_events > 0 else 0
        
        error_count = 1 if random.random() < error_prob else 0
        
        return {
            'event_type': event_type,
            'watch_duration': watch_duration,
            'position': position,
            'completion_percentage': round(completion_percentage, 2),
            'buffering_events': buffering_events,
            'buffering_duration': buffering_duration,
            'error_count': error_count
        }
    
    def _generate_timestamp(self, date_range_days: int) -> datetime:
        end_date = datetime.now()
        start_date = end_date - timedelta(days=date_range_days)
        
        date = self.fake.date_time_between(start_date=start_date, end_date=end_date)
        
        hour = np.random.choice(24, p=self.hourly_weights)
        minute = random.randint(0, 59)
        second = random.randint(0, 59)
        
        return date.replace(hour=hour, minute=minute, second=second)
    
    def _generate_hourly_weights(self) -> List[float]:
        hours = np.arange(24)
        
        morning_peak = np.exp(-0.5 * ((hours - 7) / 2) ** 2)
        evening_peak = np.exp(-0.5 * ((hours - 20) / 3) ** 2)
        late_night = np.exp(-0.5 * ((hours - 23) / 2) ** 2) * 0.5
        
        weights = morning_peak * 0.3 + evening_peak * 1.0 + late_night * 0.4
        
        weights = weights / weights.sum()
        
        return weights